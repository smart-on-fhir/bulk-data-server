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
     * 
     * @param {string} id 
     * @returns {Promise<ExportManager>}
     */
    static find(id)
    {
        return lib.readJSON(`${__dirname}/jobs/${id}.json`).then(
            state =>  new ExportManager(state)
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
            dir: __dirname + "/jobs/",
            filter: path => path.endsWith(".json")
        }, (path, fileStats, next) => {
            return lib.readJSON(path).then(state => {
                if (/*state.jobStatus === "EXPORTED" &&*/ Date.now() - state.createdAt > config.maxExportAge * 60000) {
                    fs.unlink(path, err => {
                        /* istanbul ignore if */
                        if (err) {
                            console.error(err);
                        }
                        next();
                    });
                }
                else {
                    next();
                }
            });
        }).then(() => {
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
            .setSince(options.since);

        ["resourceTypes", "fhirElements", "id", "requestStart", "secure", "patients",
         "outputFormat", "request", "fileError","jobStatus", "extended", "createdAt",
        "ignoreTransientError"].forEach(key => {
            if (key in options) {
                this[key] = options[key];
            }
        });

        if (!this.createdAt) {
            this.createdAt = Date.now();
        }

        this.save()
    }

    save()
    {
        fs.writeFileSync(
            `${__dirname}/jobs/${this.id}.json`,
            JSON.stringify(this.toJSON(), null, 4)
        );
    }

    delete()
    {
        deleteFileIfExists(`${__dirname}/jobs/${this.id}.json`);
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
            kickoffErrors          : this.kickoffErrors
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

        if (_typeFilter) {
            const outcome = lib.createOperationOutcome(`The "_typeFilter" parameter is not supported by this server`);
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
        this.save();

        // Instead of generating the response, and then returning it, the server
        // returns a 202 Accepted header, and a Content-Location at which the
        // client can use to access the response.
        // HTTP/1.1 202 Accepted
        res.set("Content-Location", url);
        lib.outcomes.exportAccepted(res, url);
    }

    async handleStatus(req, res) {

        if (this.secure && !req.headers.authorization) {
            return lib.operationOutcome(res, "Not authorized", { httpCode: 401 });
        }
    
        if (this.jobStatus === "EXPORTED") {
            return lib.outcomes.cancelCompleted(res);
        }

        if (!this.ignoreTransientError && this.simulatedError == "transient_error") {
            this.ignoreTransientError = true;
            this.save();
            return lib.operationOutcome(res, "An unknown error ocurred (transient_error). Please try again.", {
                httpCode : 500,
                issueCode: "transient"
            });
        }
    
        // ensure requestStart param is present
        let requestStart = moment(this.requestStart);
    
        // check if the user should (continue to) wait
        let endTime = moment(requestStart).add(this.simulatedExportDuration, "seconds");
        let now = moment();
    
        // If waiting - show progress and exit
        if (endTime.isAfter(now, "second")) {
            let diff = (+now - +requestStart)/1000;
            let pct = Math.round((diff / this.simulatedExportDuration) * 100);
            return res.set({
                "X-Progress" : pct + "%",
                "Retry-After": Math.ceil(this.simulatedExportDuration - diff)
            }).status(202).end();
        }
    
        // ---------------------------------------------------------------------
        // Now the simulated file generation is complete!
        // ---------------------------------------------------------------------

        this.jobStatus = "EXPORTED";
        this.save();
    
        // Count all the requested resources in the database.
        let builder = new QueryBuilder({
            type       : this.resourceTypes,
            patients   : this.patients,
            group      : this.group,
            systemLevel: this.systemLevel,
            start      : this.since
        });
        let { sql, params } = builder.compileCount();
        const DB = getDB(this.stu);
        DB.promise("all", sql, params).then(rows => {
            // console.log(sql, rows, this)
            // Finally generate those download links
            let len = rows.length;
            let linksArr   = [];
            let errorArr   = [...this.kickoffErrors];
            let deletedArr = [];
            let linksLen   = 0;
            let baseUrl    = config.baseUrl //+ req.originalUrl.split("?").shift().replace(/\/[^/]+\/fhir\/.*/, "");
            
            for(let y = 0; y < len; y++ ) { // for each selected resource
                let row = rows[y];
                let n = Math.ceil((row.rowCount * this.databaseMultiplier)/this.resourcesPerFile); // how many files for this resource
                for (let i = 0; i < n; i++) { // generate each file path
    
                    if (linksLen > config.maxFiles) {
                        return res.status(413).send("Too many files");
                    }

                    // console.log(y, y % 2, this.simulatedError)
                    if (this.simulatedError == "some_file_generation_failed" && i % 2) {
                        errorArr.push({
                            type : "OperationOutcome",
                            url: lib.buildUrlPath(
                                baseUrl,
                                base64url.encode(JSON.stringify({
                                    id: this.id,
                                    fileError: `Failed to export ${i + 1}.${row.fhir_type}.${this.outputFormat}`
                                })),
                                "/fhir/bulkfiles/",
                                `${i + 1}.${row.fhir_type}.${this.outputFormat}`
                            )
                        });
                    }
                    else {
                        let offset = this.resourcesPerFile * i;
                        let count = Math.min(
                            this.resourcesPerFile,
                            row.rowCount * this.databaseMultiplier - offset
                        );

                        // Here we know we have a list of {count} resources that
                        // we can put into a file by generating the proper link
                        // to it. However, if {this.simulateDeletedPct} is set,
                        // certain percentage of them should go into the
                        // "deleted" array instead!
                        if (this.simulateDeletedPct && this.since) {
                            let cnt = Math.round(count/100 * this.simulateDeletedPct);
                            
                            cnt && deletedArr.push({
                                type: row.fhir_type,
                                count: cnt,
                                url: lib.buildUrlPath(
                                    baseUrl,
                                    base64url.encode(JSON.stringify({
                                        id    : this.id,
                                        limit : cnt,
                                        del   : 1,
                                        offset
                                    })),
                                    "/fhir/bulkfiles/",
                                    `${i + 1}.${row.fhir_type}.${this.outputFormat}`
                                )
                            });

                            count  -= cnt;
                            offset += cnt;
                        }

                        linksLen = linksArr.push({
                            type: row.fhir_type,
                            count: count,
                            url: lib.buildUrlPath(
                                baseUrl,
                                base64url.encode(JSON.stringify({
                                    id    : this.id,
                                    offset,
                                    limit : count
                                })),
                                "/fhir/bulkfiles/",
                                `${i + 1}.${row.fhir_type}.${this.outputFormat}`
                            )
                        });
                    }
                }
            }
    
            res.set({
                "Expires": new Date(this.createdAt + config.maxExportAge * 60000).toUTCString()
            }).json({
    
                // a FHIR instant type that indicates the server's time when the
                // query is run. No resources that have a modified data after this
                // instant should be in the response.
                "transactionTime": requestStart,
    
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
                "output" : linksArr,

                // When a _since timestamp is supplied in the export request,
                // this array SHALL be populated with output files containing
                // FHIR Transaction Bundles that indicate which FHIR resources
                // would have been returned, but have been deleted subsequent to
                // that date. If no resources have been deleted or the _since
                // parameter was not supplied, the server MAY omit this key
                // or MAY return an empty array.
                "deleted": deletedArr,

                // If no errors occurred, the server should return an empty array
                "error": errorArr
            }).end();
        });
    };

    async download(req, res)
    {
        if (this.secure && !req.headers.authorization) {
            return lib.operationOutcome(res, "Not authorized", { httpCode: 401 });
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
            fileName   : req.params.file,
            stu        : this.stu,
            databaseMultiplier: this.databaseMultiplier,
            extended   : this.extended,
            group      : this.group,
            limit      : req.sim.limit,
            offset     : req.sim.offset,
            since      : this.since,
            systemLevel: this.systemLevel,
            patients   : this.patients
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
