const Transform   = require("stream").Transform;
const base64url   = require("base64-url");
const lib         = require("../lib");
const { baseUrl } = require("../config");

module.exports = function(sim = {}) {
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: true,
        transform(row, _encoding, next) {
            try {

                // We need to read the json, but this will also verify that it
                // can be parsed
                const json = JSON.parse(row.resource_json);

                // Rewrite urls in DocumentReference resources. Only url props
                // that begin with `/files/` will be converted to absolute HTTP
                // URLs to allow the client to directly download bigger files
                if (json.resourceType == "DocumentReference") {
                    const url = lib.getPath(json, "content.0.attachment.url");
                    if (url.search(/\/attachments\/.*/) === 0) {
                        // json.content[0].attachment.url = baseUrl + url;
                        json.content[0].attachment.url = lib.buildUrlPath(
                            baseUrl,
                            base64url.encode(JSON.stringify({ err: sim.err || "" })),
                            "fhir",
                            url
                        );
                        row.resource_json = JSON.stringify(json);
                    }
                }

                this.push(row);
                setImmediate(next);
            } catch (error) {
                setImmediate(next, error);
            }
        }
    });
};

