const https        = require("https");
const lib          = require("../lib");
const Task         = require("./Task");
const NDJSONStream = require("./NDJSONStream");
const ResourceValidator = require("./ResourceValidator");

const ACCEPTABLE_CONTENT_TYPES = [
    "application/x-ndjson",
    "text/x-ndjson",
    "application/json",
    "text/json",
    "text/plain",
    "application/octet-stream"
];

const REDIRECT_CODES = [
    // HTTP Status Code | HTTP Version | Temporary / Permanent | Cacheable      | Request Method Subsequent Request
    301,                // HTTP/1.0      Permanent               Yes             GET / POST may change
    302,                // HTTP/1.0      Temporary               not by default  GET / POST may change
    303,                // HTTP/1.1      Temporary               never           always GET
    307,                // HTTP/1.1      Temporary               not by default  may not change
    308                 // HTTP/1.1      Permanent               by default      may not change
];

const MAX_REDIRECTS = 10;

class DownloadTask extends Task
{
    /**
     * Creates a DownloadTask instance
     * @param {object} options
     * @param {string} options.url
     * @param {string} [options.type]
     */
    constructor(options)
    {
        super(options);
        this._count = 0;
    }

    /**
     * Makes the request in order to receive the response headers and obtain the
     * "content-length" header (if any).
     */
    init()
    {
        let redirects = 0;

        const request = (url = this.options.url) => {
            return new Promise((resolve, reject) => {
                try {
                    const req = https.request(url, {
                        timeout: 1000 * 60 * 5, // 5 min per file
                        rejectUnauthorized: process.env.NODE_ENV !== "test"
                    });
    
                    req.once("error", reject);
                    req.on("response", res => {

                        // Follow redirects
                        if (REDIRECT_CODES.indexOf(res.statusCode) > -1) {
                            if (++redirects > MAX_REDIRECTS) {
                                return reject(new Error("Too many redirects"));
                            }
                            return request(res.headers.location).then(resolve, reject);
                        }

                        this.response = res;

                        if (res.statusCode >= 400) {
                            return reject(new Error(`${res.statusCode} ${res.statusMessage}`));
                        }

                        // Check if the returned content-type can be handled
                        const contentType = String(res.headers["content-type"]).toLocaleLowerCase();
                        const match = ACCEPTABLE_CONTENT_TYPES.find(type => contentType.indexOf(contentType) === 0);
                        if (!match) {
                            return reject(new Error(
                                `Invalid content-type (${contentType}) returned from ${url
                                }. Supported content types are "${ACCEPTABLE_CONTENT_TYPES.join('", "')}".`
                            ));
                        }
    
                        // If "content-length" is present in the response headers, use it
                        // to compute the progress information. Otherwise `contentLength`
                        // will be `0`.
                        this.total = lib.uInt(res.headers["content-length"]);
    
                        res.on("end", () => this.end());
                        res.on("error", (e) => this.emit("error", e));
    
                        resolve(res);
                    })
                    req.end();
                } catch (ex) {
                    reject(ex);
                }
            });    
        };

        this.startTime = Date.now();
        
        return request();
    }

    get count()
    {
        return this._count;
    }

    async start()
    {
        if (!this.response) {
            try {
                this.response = await this.init();
            } catch (ex) {
                this.error = ex;
            }
        }

        const transformer = new NDJSONStream();
        const pipeline = this.response
            .pipe(transformer)
            .pipe(new ResourceValidator(this.options.type));

        transformer.once("error", error => {
            this.end(error);
        });

        pipeline.once("error", error => {
            this.end(error);
        });

        this.response.on("data", chunk => {
            this.position += Buffer.byteLength(chunk);
        });

        transformer.on("data", () => {
            this._count = transformer.count;
        });

        return pipeline;
    }
}

module.exports = DownloadTask;
