const crypto       = require("crypto");
const moment       = require("moment");
const fs           = require("fs");
const base64url    = require("base64-url");
const zlib         = require("zlib");
const config       = require("./config");
const lib          = require("./lib");
const QueryBuilder = require("./QueryBuilder");
const getDB        = require("./db");
const toNdjson     = require("./transforms/dbRowToNdjson");
const toCSV        = require("./transforms/dbRowToCSV");
const fhirStream   = require("./FhirStream");
const translator   = require("./transforms/dbRowTranslator");

const supportedFormats = {
    "application/fhir+ndjson" : "ndjson",
    "application/ndjson"      : "ndjson",
    "ndjson"                  : "ndjson",
    "text/csv"                : "csv",
    "csv"                     : "csv"
};

const exportTypes = {
    ndjson: {
        fileExtension: "ndjson",
        contentType  : "application/fhir+ndjson",
        transform    : toNdjson
    },
    csv: {
        fileExtension: "csv",
        contentType  : "text/csv; charset=UTF-8; header=present",
        transform    : toCSV
    }
};

function getExportParam(req, name)
{
    if (req.method == "GET") {
        return req.query[name];
    }
    
    if (req.method == "POST") {
        const out = [];
        (req.body.parameter || []).forEach(x => {
            if (x.name === name) {
                const valueX = Object.keys(x).find(key => key.indexOf("value") === 0);
                if (valueX) {
                    out.push(x[valueX]);
                }
            }
        });

        if (out.length) {
            return out.length === 1 ? out[0] : out;
        }
    }

    return null;
}

function isFile(path)
{
    try {
        const stat = fs.statSync(path);
        return stat.isFile();
    } catch {
        return false;
    }
}

function deleteFileIfExists(path)
{
    try {
        if (isFile(path)) {
            fs.unlinkSync(path);
        }
    } catch (ex) {
        console.error(ex);
        return false;
    }
    return true;
}

const ABORT_CONTROLLERS = new Map();

class ExportManager
{
    /**
     * Simulated error (if any)
     * @type {string}
     */
    simulatedError = "";

    /**
     * Simulated export duration
     * @type {number}
     */
    simulatedExportDuration;

    /**
     * Database size multiplier
     * @type {number}
     */
    databaseMultiplier = 1;

    /**
     * FHIR version as integer (2|3|4)
     * @type {number}
     */
    stu = 4;

    /**
     * How many FHIR resources to include in one file
     * @type {number}
     */
    resourcesPerFile = config.defaultPageSize;

    /**
     * Access Token LifeTime in minutes
     * @type {number}
     */
    accessTokenLifeTime = config.defaultTokenLifeTime;

    /**
     * An array of resourceTypes (from the _type parameter)
     * @type {string[]}
     */
    resourceTypes;

    /**
     * An array of FHIR element paths (from the _elements parameter)
     * @type {string[]}
     */
    fhirElements;

    /**
     * Unique ID for this job
     * @type {string}
     */
    id;

    /**
     * When was the export started? JS timestamp.
     * @type {number}
     */
    requestStart;

    /**
     * True if an authorization header has been passed to kick-off
     * @type {boolean}
     */
    secure;

    /**
     * File extension (ndjson|csv). Based on the _outputFormat parameter.
     * @type {string}
     */
    outputFormat;

    /**
     * The group ID (if any)
     * @type {string}
     */
    group;

    /**
     * The kick-off request URL
     * @type {string}
     */
    request;

    /**
     * The modified since FHIR instant (the _since parameter)
     * @type {string}
     */
    since;

    /**
     * The _typeFilter parameter
     * @type {URLSearchParams}
     */
    typeFilter;

    /**
     * true for system-level exports and false otherwise
     * @type {boolean}
     */
    systemLevel;

    /**
     * Array of patient IDs to filter by (from the patient parameter)
     * @type {string[]}
     */
    patients;

    /**
     * Generated file download error (if any)
     * @type {string}
     */
    fileError;

    /**
     * The status of this job
     */
    jobStatus = "UNDEFINED";

    /**
     * When a _since timestamp is supplied in the export request, a portion of
     * the resources (expressed as percentage here) will be reported as deleted
     * using the deleted field in the output JSON.
     */
    simulateDeletedPct = 0;

    extended = false;

    /**
     * An array to hold kickoff errors that should be included in the errors
     * payload property if lenient handling is preferred
     */
    kickoffErrors;

    /**
     * Percent complete (0 to 100)
     */
    progress = 0;

    statusMessage = "Please wait...";

    /**
     * @type {Record<string, any> | null}
     */
    manifest = null;

    tooManyFiles = false;

    // fsPromise = Promise.resolve();

    getAbortController() {
        let ctl = ABORT_CONTROLLERS.get(this.id)
        if (!ctl) {
            ctl = new AbortController()
            ABORT_CONTROLLERS.set(this.id, ctl)
        }
        return ctl
    }

    /**
     * 
     * @param {string} id 
     * @returns {Promise<ExportManager>}
     */
    static find(id)
    {
        return lib.readJSON(`${config.jobsPath}/${id}.json`).then(
            state => new ExportManager(state || {})
        );
    }

    static createKickOffHandler(system = false)
    {
        return function(req, res) {
            const job = new ExportManager({
                simulatedError         : req.sim.err,
                simulatedExportDuration: req.sim.dur,
                databaseMultiplier     : req.sim.m,
                // stu                    : req.sim.stu,
                resourcesPerFile       : req.sim.page,
                accessTokenLifeTime    : req.sim.tlt,
                fileError              : req.sim.fileError,
                simulateDeletedPct     : req.sim.del
            });
            job.kickOff(req, res, system);
        }
    }

    static createCancelHandler()
    {
        return function cancelFlow(req, res) {
            return ExportManager.find(req.params.id).then(
                job => job.cancel(res),
                () => lib.outcomes.cancelNotFound(res)
            );
        };
    }

    static createStatusHandler()
    {
        return function handleStatus(req, res) {
            return ExportManager.find(req.params.id).then(
                job => job.handleStatus(req, res),
                err => lib.operationOutcome(res, err.message, { httpCode: 400 })
            );
        }
    };

    static createDownloadHandler()
    {
        return function handleFileDownload(req, res, next) {
            ExportManager.find(req.sim.id).then(
                job => job.download(req, res).catch(next),
                () => lib.outcomes.exportDeleted(res)
            );
        }
    }

    static cleanUp()
    {
        return lib.forEachFile({
            dir: config.jobsPath,
            filter: path => path.endsWith(".json")
        }, path => lib.readJSON(path).then(state => {
            if (state && Date.now() - state.createdAt > config.maxExportAge * 60000) {
                return fs.promises.unlink(path);
            }
        })).then(() => {
            /* istanbul ignore if */
            if (process.env.NODE_ENV != "test") {
                setTimeout(ExportManager.cleanUp, 5000).unref();
            }
        });
    }
    
    constructor(options = {})
    {
        this.id = crypto.randomBytes(16).toString("hex");

        this.kickoffErrors = options.kickoffErrors || [];

        this.setSimulatedError(options.simulatedError)
            .setSimulatedExportDuration(options.simulatedExportDuration)
            .setDatabaseMultiplier(options.databaseMultiplier)
            .setSTU(options.stu)
            .setResourcesPerFile(options.resourcesPerFile)
            .setAccessTokenLifeTime(options.accessTokenLifeTime)
            .setSystemLevel(options.systemLevel)
            .setGroup(options.group)
            // .setPatients(options.patients)
            .setSimulateDeletedPct(options.simulateDeletedPct)
            .setSince(options.since)
            .setTypeFilter(options.typeFilter);

        ["resourceTypes", "fhirElements", "id", "requestStart", "secure", "patients",
         "outputFormat", "request", "fileError","jobStatus", "extended", "createdAt",
        "ignoreTransientError", "progress", "statusMessage", "manifest", "tooManyFiles"]
        .forEach(key => {
            if (key in options) {
                this[key] = options[key];
            }
        });

        if (!this.createdAt) {
            this.createdAt = Date.now();
        }

        this.save()
    }

    async save()
    {
        // DO NOT RE-CREATE THE FILE IF ALREADY ABORTED
        if (!ABORT_CONTROLLERS.has(this.id)) {
            return true;
        }

        const path = `${config.jobsPath}/${this.id}.json`;
        const data = JSON.stringify(this.toJSON(), null, 4);
        fs.writeFileSync(path, data, "utf8");
        return true;
    }

    delete()
    {
        const path = `${config.jobsPath}/${this.id}.json`;
        this.getAbortController().abort();
        deleteFileIfExists(path);
        ABORT_CONTROLLERS.delete(this.id);
    }

    toJSON()
    {
        return {
            simulatedError         : this.simulatedError,
            simulatedExportDuration: this.simulatedExportDuration,
            databaseMultiplier     : this.databaseMultiplier,
            stu                    : this.stu,
            resourcesPerFile       : this.resourcesPerFile,
            accessTokenLifeTime    : this.accessTokenLifeTime,
            resourceTypes          : this.resourceTypes,
            fhirElements           : this.fhirElements,
            id                     : this.id,
            requestStart           : this.requestStart,
            secure                 : this.secure,
            outputFormat           : this.outputFormat,
            group                  : this.group,
            request                : this.request,
            since                  : this.since,
            systemLevel            : this.systemLevel,
            patients               : this.patients,
            fileError              : this.fileError,
            jobStatus              : this.jobStatus,
            extended               : this.extended,
            createdAt              : this.createdAt,
            ignoreTransientError   : this.ignoreTransientError,
            simulateDeletedPct     : this.simulateDeletedPct,
            kickoffErrors          : this.kickoffErrors,
            typeFilter             : this.typeFilter.toString(),
            progress               : this.progress,
            statusMessage          : this.statusMessage,
            manifest               : this.manifest,
            tooManyFiles           : this.tooManyFiles
        };
    }

    async kickOff(req, res, system)
    {

        const isLenient = !!String(req.headers.prefer || "").match(/\bhandling\s*=\s*lenient\b/i);

        // Verify that the POST body contains a Parameters resource ------------
        if (req.method == "POST" && req.body.resourceType !== "Parameters") {
            return lib.operationOutcome(res, "The POST body should be a Parameters resource", { httpCode: 400 });
        }

        // Validate the accept header ------------------------------------------
        // let accept = req.headers.accept;
        // if (!accept || accept == "*/*") {
        //     accept = "application/fhir+ndjson"
        // }
        // if (accept != "application/fhir+ndjson" && accept != "application/fhir+json") {
        //     return lib.outcomes.invalidAccept(res, accept);
        // }

        // Simulate file_generation_failed error if requested ------------------
        if (this.simulatedError == "file_generation_failed") {
            return lib.outcomes.fileGenerationFailed(res);
        }

        try {
            this.setSTU(req.sim.stu);
        } catch (ex) {
            return lib.operationOutcome(res, ex.message, { httpCode: 400 });
        }

        this.setGroup(req.params.groupId);
        this.setSystemLevel(system);

        this.extended = !!req.sim.extended;

        const _type         = getExportParam(req, "_type")         || "";
        const _patient      = getExportParam(req, "patient")       || "";
        const _since        = getExportParam(req, "_since")        || "";
        const _outputFormat = getExportParam(req, "_outputFormat") || "application/fhir+ndjson";
        const _elements     = getExportParam(req, "_elements")     || "";
        const _typeFilter   = getExportParam(req, "_typeFilter")   || "";
        const _includeAssociatedData = getExportParam(req, "_includeAssociatedData") || "";

        if (_includeAssociatedData) {
            const outcome = lib.createOperationOutcome(`The "_includeAssociatedData" parameter is not supported by this server`);
            if (!isLenient) {
                this.delete();
                return res.status(400).json(outcome);
            }
            this.kickoffErrors.push(outcome);
        }

        if (_patient && req.method != "POST") {
            return lib.operationOutcome(res, `The "patient" parameter is only available in POST requests`, { httpCode: 400 });
        }

        try {
            this.setTypeFilter(_typeFilter)
        } catch (ex) {
            return lib.operationOutcome(res, ex.message, { httpCode: 400 });
        }

        try {
            await this.setResourceTypes(_type);
        } catch (ex) {
            return lib.operationOutcome(res, ex.message, { httpCode: 400 });
        }

        try {
            this.setPatients(_patient);
        } catch (ex) {
            return lib.operationOutcome(res, ex.message, { httpCode: 400 });
        }

        try {
            this.setSince(_since);
        } catch (ex) {
            return lib.outcomes.invalidSinceParameter(res, _since);
        }

        try {
            await this.setFHIRElements(_elements);
        } catch (ex) {
            return lib.operationOutcome(res, ex.message, { httpCode: 400 });
        }

        if (!supportedFormats.hasOwnProperty(_outputFormat)) {
            return lib.operationOutcome(res, `The "${_outputFormat}" _outputFormat is not supported`, { httpCode: 400 });
        }
        this.outputFormat = supportedFormats[_outputFormat];

        this.requestStart = Date.now();
        this.secure = !!req.headers.authorization;

        const proto = req.headers["x-forwarded-proto"] || req.protocol;
        this.request = proto + "://" + req.headers.host + req.originalUrl;

        // Prepare the status URL
        let url = config.baseUrl + req.originalUrl.split("?").shift().replace(
            /(\/[^/]+)?\/fhir\/.*/,
            `/fhir/bulkstatus/${this.id}`
        );

        this.jobStatus = "STARTED";

        const abortSignal = this.getAbortController().signal;

        await this.save();

        lib.abortablePromise(this.buildManifest(abortSignal), abortSignal).catch(e => {
            if (!(e instanceof lib.AbortError)) {
                console.error(e)
            }
        });

        // Instead of generating the response, and then returning it, the server
        // returns a 202 Accepted header, and a Content-Location at which the
        // client can use to access the response.
        // HTTP/1.1 202 Accepted
        res.set("Content-Location", url);
        lib.outcomes.exportAccepted(res, url);
    }

    /**
     * Finds all the resource types included in this export and their count
     * @returns {Promise<{ fhir_type: string, rowCount: number }[]>}
     */
    async getResourceTypes() {
        const builder = new QueryBuilder({
            type       : this.resourceTypes,
            patients   : this.patients,
            group      : this.group,
            systemLevel: this.systemLevel,
            start      : this.since
        });
        const { sql, params } = builder.compileCount();
        const DB = getDB(this.stu);
        return DB.promise("all", sql, params);
    }

    /**
     * Creates and returns a ReadableStream of JSON FHIR resources
     * @param {string} resourceType 
     * @returns {fhirStream}
     */
    getStreamForResource(resourceType, limit) {
        return new fhirStream({
            types      : [resourceType],
            stu        : this.stu,
            databaseMultiplier: this.databaseMultiplier,
            extended   : this.extended,
            group      : this.group,
            since      : this.since,
            systemLevel: this.systemLevel,
            patients   : this.patients,
            offset     : 0,
            filter     : this.typeFilter.get("_filter"),
            limit
        });
    }

    async getCountsForResourceType(resourceType, limit) {
        return new Promise((resolve, reject) => {
            let input = this.getStreamForResource(resourceType, limit);
            input.init().then(() => {
                let count = 0;
                input.once("error", reject)
                input.once("close", () => resolve(count))
                input.on("data", () => { count += 1; })
            }, reject);
        });
    }

    /**
     * @param {AbortSignal} signal
     */
    async buildManifest(signal) {

        let requestStart = moment(this.requestStart);

        /** @type {any} */
        const manifest = {
    
            // a FHIR instant type that indicates the server's time when the
            // query is run. No resources that have a modified data after this
            // instant should be in the response.
            "transactionTime": requestStart + "",

            // the full url of the original bulk data kick-off request
            "request" : this.request,

            // boolean value indicating whether downloading the generated files
            // will require an authentication token. Note: This may be false in
            // the case of signed S3 urls or an internal file server within an
            // organization's firewall.
            "requiresAccessToken": this.secure,

            // array of bulk data file items with one entry for each generated
            // file. Note: If no data is returned from the kick-off request,
            // the server should return an empty array.
            "output" : [],

            // When a _since timestamp is supplied in the export request,
            // this array SHALL be populated with output files containing
            // FHIR Transaction Bundles that indicate which FHIR resources
            // would have been returned, but have been deleted subsequent to
            // that date. If no resources have been deleted or the _since
            // parameter was not supplied, the server MAY omit this key
            // or MAY return an empty array.
            "deleted": [],

            // If no errors occurred, the server should return an empty array
            "error": []
        };

        try {
            var resourceTypes = await lib.abortablePromise(this.getResourceTypes(), signal);
        } catch (e) {
            if (!(e instanceof lib.AbortError)) {
                console.error(e)
            }
            return null
        }

        const totalResourceCount = resourceTypes.reduce((prev, cur) => prev + cur.rowCount, 0) * this.databaseMultiplier;

        /**
         * @param {number} index Zero-based file index
         * @param {string} resourceType 
         * @param {number} count
         * @param {number} offset
         */
        const addDeleted = (index, resourceType, count, offset, filteredCount) => {
            manifest.deleted.push({
                type: resourceType,
                count: filteredCount,
                url: lib.buildUrlPath(
                    config.baseUrl,
                    base64url.encode(JSON.stringify({
                        id    : this.id,
                        limit : count,
                        del   : 1,
                        secure: this.secure,
                        offset
                    })),
                    "/fhir/bulkfiles/",
                    `${index + 1}.${resourceType}.${this.outputFormat}`
                )
            }); 
        }

        /**
         * @param {number} index Zero-based file index
         * @param {string} resourceType 
         * @param {string} error 
         */
        const addError = (index, resourceType, error) => {
            manifest.error.push({
                type : "OperationOutcome",
                url: lib.buildUrlPath(
                    config.baseUrl,
                    base64url.encode(JSON.stringify({
                        id: this.id,
                        secure: this.secure,
                        fileError: error
                    })),
                    "/fhir/bulkfiles/",
                    `${index + 1}.${resourceType}.${this.outputFormat}`
                )
            });
        };

        /**
         * @param {number} index Zero-based file index
         * @param {string} resourceType 
         * @param {number} count
         * @param {number} offset 
         */
        const addFile = (index, resourceType, count, offset, filteredCount) => {
            manifest.output.push({
                type: resourceType,
                count: filteredCount,
                url: lib.buildUrlPath(
                    config.baseUrl,
                    base64url.encode(JSON.stringify({
                        id    : this.id,
                        offset,
                        limit : count,
                        secure: this.secure,
                    })),
                    "/fhir/bulkfiles/",
                    `${index + 1}.${resourceType}.${this.outputFormat}`
                )
            });
        };

        for (const { fhir_type, rowCount } of resourceTypes) {
            
            if (signal.aborted) {
                return null;
            }

            this.statusMessage = `currenly processing ${fhir_type} resources`;
            await this.save()

            let resourceCount = rowCount * this.databaseMultiplier;
            let filteredCount = resourceCount;

            // If a filter is used we need to actualy loop tru, filter and count how many
            // resorces would remain after the dilter
            if (this.typeFilter.get("_filter")) {
                try {
                    filteredCount = await lib.abortablePromise(this.getCountsForResourceType(fhir_type, resourceCount), signal);
                } catch (e) {
                    if (!(e instanceof lib.AbortError)) {
                        console.error(e)
                        return null
                    }
                }
            }

            if (filteredCount > 0) {
                const numFiles = Math.ceil(filteredCount / this.resourcesPerFile);
                for (let i = 0; i < numFiles; i++) {

                    // ~ half of the links might fail if such error is requested
                    if (this.simulatedError == "some_file_generation_failed" && i % 2) {
                        addError(i, fhir_type, `Failed to export ${i + 1}.${fhir_type}.${this.outputFormat}`);
                    }

                    // Add normal download link
                    else {
                        let offset = this.resourcesPerFile * i;
                        let count = Math.min(this.resourcesPerFile, filteredCount - offset);
                        

                        // Here we know we have a list of {count} resources that
                        // we can put into a file by generating the proper link
                        // to it. However, if {this.simulateDeletedPct} is set,
                        // certain percentage of them should go into the
                        // "deleted" array instead!
                        if (this.simulateDeletedPct && this.since) {
                            let cnt = Math.round(count/100 * this.simulateDeletedPct);
                            if (cnt) {
                                addDeleted(
                                    i,
                                    fhir_type,
                                    cnt,
                                    offset,
                                    Math.min(this.resourcesPerFile, Math.abs(filteredCount - offset))
                                );
                                count  -= cnt;
                                offset += cnt;
                            }
                        }

                        addFile(
                            i,
                            fhir_type,
                            count,
                            offset,
                            Math.max(Math.min(this.resourcesPerFile, filteredCount - offset), 0)
                        );
                    }

                    // Limit the manifest size based on total number of file links
                    if (manifest.output.length + manifest.error.length + manifest.deleted.length > config.maxFiles) {
                        this.tooManyFiles = true;
                        await this.save();
                        return null;
                    }
                }
            }

            this.progress += (rowCount * this.databaseMultiplier / totalResourceCount * 100)
            // console.log(`Progress =======> ${this.progress}%`);
            await this.save()
        }

        this.manifest = manifest
        await this.save()
        return manifest
    }

    async handleStatus(req, res) {

        if (this.secure && !req.headers.authorization) {
            return lib.operationOutcome(res, "Not authorized", { httpCode: 401 });
        }

        if (this.tooManyFiles) {
            return res.status(413).send("Too many files");
        }

        // const signal = this.getAbortController().signal

        if (!this.ignoreTransientError && this.simulatedError == "transient_error") {
            this.ignoreTransientError = true;
            await this.save();
            return lib.operationOutcome(
                res,
                "An unknown error ocurred (transient_error). Please try again.",
                {
                    httpCode : 500,
                    issueCode: "transient"
                }
            );
        }

        if (this.jobStatus === "EXPORTED") {
            return lib.outcomes.cancelCompleted(res);
        }

        // ensure requestStart param is present
        // let requestStart = moment(this.requestStart);

        // If waiting - show progress and exit
        if (this.typeFilter.get("_filter") || this.simulatedExportDuration <= 0) {
            if (Math.round(this.progress) < 100) {
                return res.set({
                    "X-Progress" : Math.round(this.progress) + "% complete, " + this.statusMessage,
                    "Retry-After": 1
                }).status(202).end();
            }
        } 
        else {
            // check if the user should (continue to) wait
            let requestStart = moment(this.requestStart);
            let endTime = moment(requestStart).add(this.simulatedExportDuration, "seconds");
            let now = moment();
        
            // If waiting - show progress and exit
            if (endTime.isAfter(now, "second")) {
                let diff = (+now - +requestStart)/1000;
                let pct = Math.round((diff / this.simulatedExportDuration) * 100);
                return res.set({
                    "X-Progress" : pct + "% complete, " + this.statusMessage,
                    "Retry-After": 2//Math.ceil(this.simulatedExportDuration - diff)
                }).status(202).end();
            }
        }

        

        if (!this.manifest) {
            return lib.operationOutcome(res, "Failed to build export manifest.", {
                httpCode : 400,
                // issueCode: "transient"
            });
        }

        this.jobStatus = "EXPORTED";
        await this.save()

        res.set({
            "Expires": new Date(this.createdAt + config.maxExportAge * 60000).toUTCString()
        }).json(this.manifest);
    };

    async download(req, res)
    {
        if (this.secure && !req.headers.authorization) {
            return lib.operationOutcome(res, "Not authorized", { httpCode: 401 });
        }

        if (this.secure) {
            const grantedScopes = lib.getGrantedScopes(req)
            const resourceType  = req.params.file.split(".")[1]
            const hasAccess = lib.hasAccessToResourceType(grantedScopes, resourceType, "read")
            if (!hasAccess) {
                return lib.operationOutcome(res, "Permission denied", { httpCode: 403 });
            }
        }

        if (this.jobStatus !== "EXPORTED") {        
            return lib.outcomes.exportNotCompleted(res);
        }

        // console.log(req.sim, this)
        const fileError = req.sim.fileError;

        // early exit in case simulated errors
        if (this.simulatedError == "file_expired") {
            return lib.outcomes.fileExpired(res);
        }

        // early exit in case simulated file errors
        if (fileError) {
            return res.set({ "Content-Type": "application/fhir+ndjson" })
                .end(JSON.stringify(lib.createOperationOutcome(req.sim.fileError)));
        }

        const acceptEncoding = req.headers["accept-encoding"] || "";
        const shouldDeflate  = (/\bdeflate\b/.test(acceptEncoding));
        const shouldGzip     = (/\bgzip\b/.test(acceptEncoding));

        // set the response headers
        res.set({
            "Content-Type": exportTypes[this.outputFormat].contentType,
            "Content-Disposition": "attachment"
        });

        /* istanbul ignore else */
        if (shouldGzip) {
            res.set({ "Content-Encoding": "gzip" });
        }
        else if (shouldDeflate) {
            res.set({ "Content-Encoding": "deflate" });
        } 

        let input = new fhirStream({
            types      : [req.params.file.split(".")[1]],
            stu        : this.stu,
            databaseMultiplier: this.databaseMultiplier,
            extended   : this.extended,
            group      : this.group,
            limit      : req.sim.limit,
            offset     : req.sim.offset,
            since      : this.since,
            systemLevel: this.systemLevel,
            patients   : this.patients,
            filter     : this.typeFilter.get("_filter")
        });
        
        input.on("error", error => {
            console.error(error);
            return res.status(500).end();
        });

        input.init().then(() => {
            let pipeline = input.pipe(translator({
                _elements  : this.fhirElements,
                err        : this.fileError,
                deleted    : !!req.sim.del,
                secure     : this.secure
            }));

            const transform = exportTypes[this.outputFormat].transform;
            if (transform) {
                pipeline = pipeline.pipe(transform({ extended: this.extended }));
            }

            /* istanbul ignore else */
            if (shouldGzip) {
                pipeline = pipeline.pipe(zlib.createGzip())
            }
            else if (shouldDeflate) {
                pipeline = pipeline.pipe(zlib.createDeflate())
            } 

            pipeline.pipe(res);
        });
    }

    /**
     * After a bulk data request has been started, a client MAY send a DELETE
     * request to the URL provided in the Content-Location header to cancel the
     * request.
     * 
     * If the request has been completed, a server MAY use the request as a
     * signal that a client is done retrieving files and that it is safe for the
     * sever to remove those from storage.
     * 
     * Following the delete request, when subsequent requests are made to the
     * polling location, the server SHALL return a 404 error and an associated
     * FHIR OperationOutcome in JSON format. 
     */
    cancel(res)
    {
        this.delete();
        return lib.outcomes.cancelAccepted(res);
    }

    // SETTERS
    // -------------------------------------------------------------------------

    /**
     * @param {string} errorId 
     */
    setSimulatedError(errorId = "")
    {
        this.simulatedError = String(errorId || "").trim();
        return this;
    }

    /**
     * Sets the simulated file generation duration in seconds
     * @param {number} duration 
     */
    setSimulatedExportDuration(duration = config.defaultWaitTime)
    {
        this.simulatedExportDuration = lib.uInt(duration, config.defaultWaitTime);
        return this;
    }

    /**
     * Sets the database size multiplier
     * @param {number} multiplier 
     */
    setDatabaseMultiplier(multiplier = 1)
    {
        this.databaseMultiplier = lib.uInt(multiplier, 1);
        return this;
    }

    /**
     * Sets the numeric FHIR version
     * @param {number} version 
     */
    setSTU(version = 4)
    {
        const ver = lib.uInt(version, 4);
        if (ver < 2 || ver > 4) {
            throw new Error(`Invalid FHIR version "${version}". Must be 2, 3 or 4`);
        }
        this.stu = ver;
        return this;
    }

    /**
     * Sets the resourcesPerFile
     * @param {number} count 
     */
    setResourcesPerFile(count = config.defaultPageSize)
    {
        this.resourcesPerFile = lib.uInt(count, config.defaultPageSize);
        return this;
    }

    /**
     * Sets the Access Token LifeTime in minutes
     * @param {number} minutes 
     */
    setAccessTokenLifeTime(minutes = config.defaultTokenLifeTime)
    {
        this.accessTokenLifeTime = lib.uInt(minutes, config.defaultTokenLifeTime);
        return this;
    }

    /**
     * Set what percentage of the output resources should be reported as deleted
     * @param {number} pct 
     */
    setSimulateDeletedPct(pct = 0)
    {
        this.simulateDeletedPct = lib.uInt(pct, 0);
        return this;
    }

    /**
     * 
     * @param {boolean} isSystemLevel 
     */
    setSystemLevel(isSystemLevel)
    {
        this.systemLevel = lib.bool(isSystemLevel);
        return this;
    }

    /**
     * 
     * @param {string} groupId 
     */
    setGroup(groupId = "")
    {
        this.group = String(groupId || "").trim();
        return this;
    }

    /**
     * Sets the array of resource types to be exported
     * @param {string|string[]} types Comma-separated list or array of strings
     */
    async setResourceTypes(types)
    {
        const requestedTypes = lib.makeArray(types || "").map(t => String(t || "").trim()).filter(Boolean);
        const availableTypes = await lib.getAvailableResourceTypes(this.stu);
        if (availableTypes.indexOf("OperationDefinition") === -1) {
            availableTypes.push("OperationDefinition");
        }
        const badParam = requestedTypes.find(type => availableTypes.indexOf(type) == -1);
        if (badParam) {
            this.resourceTypes = [];
            throw new Error(`The requested resource type "${badParam}" is not available on this server`);
        }
        this.resourceTypes = requestedTypes;
    }

    /**
     * 
     * @param {{reference:string}[]} patients 
     */
    setPatients(patients)
    {
        const arr = lib.makeArray(patients).filter(Boolean);
        if (this.systemLevel && arr.length) {
            throw new Error("The patient parameter is not available in system-level export requests");
        }

        this.patients = arr.map(ref => ref.reference ?
            ref.reference.replace(/^\/?Patient\//i, "") :
            null
        ).filter(Boolean);
        return this;
    }

    /**
     * Sets the _since moment and makes sure it is in the future
     * @param {string} since FHIR Instant 
     */
    setSince(since = "")
    {
        this.since = since ? lib.fhirDateTime(since, true) : "";
        return this;
    }

    /**
     * Sets the _typeFilter parameter
     * @param {string} _typeFilter
     */
    setTypeFilter(_typeFilter = "")
    {
        this.typeFilter = new URLSearchParams(_typeFilter);
        return this;
    }

    /**
     * 
     * @param {string|string[]} elements 
     */
    async setFHIRElements(elements)
    {
        const _elements = lib.makeArray(elements || "").map(t => String(t || "").trim()).filter(Boolean);
        const availableTypes = await lib.getAvailableResourceTypes(this.stu);
    
        for (let element of _elements) {
            const match = element.match(/^([a-zA-Z]+)(\.([a-zA-Z]+))?$/);
            if (!match || !match[1]) {
                throw new Error(`The _elements parameter should contain entries of the form "[element]" or "[ResourceType].[element]". Found "${element}".`);
            }
            if (match[3]) {
                const badParam = availableTypes.indexOf(match[1]) == -1;
                if (badParam) {
                    throw new Error(`The _elements parameter includes a resource type "${match[1]}" which is not available on this server.`);
                }
            }
        }
        this.fhirElements = _elements;
        return this;
    }
};

module.exports = ExportManager;

/* istanbul ignore if */
if (process.env.NODE_ENV != "test") {
    ExportManager.cleanUp();
}
