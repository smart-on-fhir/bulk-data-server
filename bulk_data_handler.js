const base64url    = require("base64-url");
const moment       = require("moment");
const router       = require("express").Router({ mergeParams: true });
const config       = require("./config");
const Lib          = require("./lib");
const DB           = require("./db");
const QueryBuilder = require("./QueryBuilder");
const OpDef        = require("./fhir/OperationDefinition/index");
const fhirStreamer = require("./fhirStreamer");

// Errors as operationOutcome responses
const outcomes = {
    fileExpired: res => Lib.operationOutcome(
        res,
        "Access to the target resource is no longer available at the server " +
        "and this condition is likely to be permanent because the file " +
        "expired",
        { httpCode: 410 }
    ),
    noContent: res => Lib.operationOutcome(
        res,
        "No Content - your query did not match any fhir resources",
        { httpCode: 204 }
    ),
    invalidAccept: (res, accept) => Lib.operationOutcome(
        res,
        `Invalid Accept header "${accept}". Currently we only recognize "application/fhir+ndjson" and "application/fhir+json"`,
        { httpCode: 400 }
    ),
    invalidOutputFormat: (res, value) => Lib.operationOutcome(
        res,
        `Invalid output-format parameter "${value}". Currently we only ` +
        `recognize "application/fhir+ndjson", "application/ndjson" and "ndjson"`,
        { httpCode: 400 }
    ),
    requireAcceptNdjson: res => Lib.operationOutcome(
        res,
        "The Accept header must be application/fhir+ndjson",
        { httpCode: 400 }
    ),
    requirePreferAsync: res => Lib.operationOutcome(
        res,
        "The Prefer header must be respond-async",
        { httpCode: 400 }
    ),
    requireRequestStart: res => Lib.operationOutcome(
        res,
        "The request start time parameter (requestStart) is missing " +
        "in the encoded params",
        { httpCode: 400 }
    ),
    invalidRequestStart: (req, res) => Lib.operationOutcome(
        res,
        `The request start time parameter (requestStart: ${
        req.sim.requestStart}) is invalid`,
        { httpCode: 400 }
    ),
    futureRequestStart: res => Lib.operationOutcome(
        res,
        "The request start time parameter (requestStart) must be " +
        "a date in the past",
        { httpCode: 400 }
    ),
    fileGenerationFailed: res => Lib.operationOutcome(
        res,
        Lib.getErrorText("file_generation_failed")
    )
};

// Start helper express middlewares --------------------------------------------
function extractSim(req, res, next) {
    req.sim = Lib.getRequestedParams(req);
    next();
}

/**
 * Simple Express middleware that will require the request to have "accept"
 * header set to "application/fhir+ndjson".
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function requireNdjsonAcceptHeader(req, res, next) {
    if (req.headers.accept != "application/fhir+ndjson") {
        return outcomes.requireAcceptNdjson(res);
    }
    next();
}

/**
 * Simple Express middleware that will require the request to have "prefer"
 * header set to "respond-async".
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function requireRespondAsyncHeader(req, res, next) {
    if (req.headers.prefer != "respond-async") {
        return outcomes.requirePreferAsync(res);
    }
    next();
}

/**
 * Validates the requestStart parameter
 * @param {Object} req 
 * @param {Object} res 
 * @param {Function} next 
 */
function validateRequestStart(req, res, next) {
    let requestStart = req.sim.requestStart;

    // ensure requestStart param is present
    if (!requestStart) {
        return outcomes.requireRequestStart(res);
    }

    try {
        requestStart = Lib.fhirDateTime(requestStart);
    } catch (ex) {
        return outcomes.invalidRequestStart(req, res);
    }

    // requestStart - ensure valid date/time note that  using try does not
    // prevent moment from warning about an invalid input when it happens for
    // the first time
    try { requestStart = moment(requestStart); } catch (ex) {  }
    if (!requestStart.isValid()) {
        return outcomes.invalidRequestStart(req, res);
    }

    // requestStart - ensure start param is valid moment in time
    if (requestStart.isSameOrAfter(moment())) {
        return outcomes.futureRequestStart(res);
    }

    next();
}

// End helper express middlewares ----------------------------------------------

/**
 * Handles the first request of the flow (the one that from /Patient/$everything
 * or /group/:groupId/$everything)
 * @param {Object} req 
 * @param {Object} res 
 * @param {Number} groupId 
 */
function handleRequest(req, res, groupId = null) {

    // Validate the accept header
    let accept = req.headers.accept;
    if (!accept || accept == "*/*") {
        accept = "application/fhir+ndjson"
    }
    if (accept != "application/fhir+ndjson" &&
        accept != "application/fhir+json") {
        return outcomes.invalidAccept(res, accept);
    }

    // validate the output-format parameter
    let outputFormat = req.query['output-format']
    if (outputFormat &&
        outputFormat != "application/fhir+ndjson" &&
        outputFormat != "application/ndjson" &&
        outputFormat != "ndjson") {
        return outcomes.invalidOutputFormat(res, outputFormat);
    }

    // Now we need to count all the requested resources in the database.
    // This is to avoid situations where we make the clients wait certain
    // amount of time, jut to tell them that there is nothing to download.
    let builder = new QueryBuilder({

        // The _type parameter is used to specify which resource types are part
        // of the focal query – e.g. what kind of resources are returned in the
        // main set. The _type parameter has no impact on which related
        // resources are included) (e.g. practitioner details for clinical
        // resources). In the absence of this parameter, all types are included.
        type : req.query._type,

        // The start date/time means only records since the nominated time. In
        // the absence of the parameter, it means all data ever.
        start: req.query.start,

        // The chosen group ID (if any)
        group: groupId
    });

    // Create SQL query that counts resources matching the params above
    let { sql, params } = builder.compileCount();

    // Execute the count query
    return DB.promise("all", sql, params).then(rows => {

        // Early exit for queries that are valid but don't match anything
        if (!rows.length) {
            return res.status(204).end(); // No Content
        }

        // Prepare the configuration segment of the status URL. Use the current
        let args = Object.assign(
            Lib.getRequestedParams(req),
            builder.exportOptions(),
            {
                requestStart: Date.now(),
                secure: !!req.headers.authorization,
                request: req.originalUrl
            }
        );

        // Simulate file_generation_failed error if requested
        if (args.err == "file_generation_failed") {
            return outcomes.fileGenerationFailed(res);
        }

        args.request = req.originalUrl;

        // Prepare the status URL
        let params = base64url.encode(JSON.stringify(args));
        let url = config.baseUrl + req.originalUrl.split("?").shift().replace(
            /(\/[^/]+)?\/fhir\/.*/,
            `/${params}/fhir/bulkstatus`
        );

        // Instead of generating the response, and then returning it, the server
        // returns a 202 Accepted header, and a Content-Location at which the
        // client can use to access the response.
        // HTTP/1.1 202 Accepted
        res.set("Content-Location", url).status(202).end();
        
    }, error => res.send(error));
};

/**
 * Data Consumer requests a bulk data export.
 * Returns all data on all patients that the client’s account has access to,
 * since the starting date time provided.
 */
function handlePatient(req, res) {
    handleRequest(req, res);
};

/**
 * Provides access to all data on all patients in the nominated group. The
 * point of this is that applications can request data on a subset of all
 * their patients without needing a new access account provisioned (exactly
 * how the Group resource is created/identified/defined/managed is out of
 * scope for now – the question of whether we need to do sort this out has
 * been referred to ONC for consideration).
 */
function handleGroup(req, res) {
    handleRequest(req, res, +req.params.groupId);
}

function handleStatus(req, res) {

    let sim = req.sim;

    // ensure requestStart param is present
    let requestStart = req.sim.requestStart;

    // check if the user should (continue to) wait
    let generationTime = sim.dur || sim.dur === 0 ? sim.dur : config.defaultWaitTime;
    let endTime = moment(requestStart).add(generationTime, "seconds");
    let now = moment();

    // If waiting - show progress and exit
    if (endTime.isAfter(now, "second")) {
        let diff = (now - requestStart)/1000;
        let pct = Math.round((diff / generationTime) * 100);
        return res.set({ "X-Progress": pct + "%" }).status(202).end();
    }

    // Get the count multiplier
    let multiplier = parseInt(String(sim.m || "1"), 10);
    if (isNaN(multiplier) || !isFinite(multiplier) || multiplier < 1) {
        multiplier = 1;
    }

    // Count all the requested resources in the database.
    let { sql, params } = new QueryBuilder(sim).compileCount("cnt");
    DB.promise("all", sql, params).then(rows => {

        let len = rows.length;

        // Exit early if we have a valid query but it doesn't match anything
        if (!len) {
            return outcomes.noContent(res);
        }

        // Finally generate those download links
        let links    = "";
        let linksArr = []
        let linksLen = 0;
        let params   = Object.assign({}, sim);
        let baseUrl  = config.baseUrl + req.originalUrl.split("?").shift().replace(/\/[^/]+\/fhir\/.*/, "");
        let page     = sim.page || config.defaultPageSize;
        let bytes    = 0;

        for(let y = 0; y < len; y++ ) { // for each selected resource
            let row = rows[y];
            let n = Math.ceil((row.cnt * multiplier)/page); // how many files for this resource
            for (let i = 0; i < n; i++) { // generate each file path

                if (linksLen > config.maxFiles) {
                    return res.status(413).send("Too many files");
                }

                params.offset = page * i; // overwrite offset
                params.limit  = page;     // overwrite limit

                if ("request" in params) {
                    delete params.request;
                }

                if ("secure" in params) {
                    delete params.request;
                }

                // _params will be consumed by the file download endpoint
                // sample: <http://localhost:8443/v/r3/sim/eyJ...H0/fhir/bulkfiles/2.Observation.ndjson>
                let linkHref = Lib.buildUrlPath(
                    baseUrl,
                    base64url.encode(JSON.stringify(params)),
                    "/fhir/bulkfiles/",
                    `${i + 1}.${row.fhir_type}.ndjson`
                );

                let link = "<" + linkHref + ">"

                if (linksLen) {
                    link = "," + link;
                }

                bytes += Buffer.from(link).byteLength;

                if (bytes > config.maxFilesBytes) {
                    return res.status(413).send("Response headers too large");
                }

                linksArr.push({ type: row.fhir_type, url: linkHref })
                links += link;
                linksLen += 1;
            }
        }

        res.set({
            "Content-Type": "application/fhir+ndjson",
            "X-FHIR-Links-Require-Authorization": !!req.headers.authorization,

            // TODO: Set this when we implement expiration?
            // "Expires": "Wed, 21 Oct 2018 07:28:00 GMT"

            "Link": links
        });

        // console.log(sim)
        res.status(200);
        res.json({
            "transactionTime": requestStart,  //the server's time when the query is run (no resources that have a modified data after this instant should be in the response)
            "request" : sim.request, //GET request that kicked-off the bulk data response
            "secure" : !!sim.secure, //authentication is required to retrieve the files
            "output" : linksArr
        });
        res.end();
    });
};

function handleFileDownload(req, res) {

    // early exit in case simulated errors
    if (req.sim.err == "file_expired") {
        return outcomes.fileExpired(res);
    }

    // set the response headers
    res.set({
        "Content-Type": "application/fhir+ndjson",
        "Content-Disposition": "attachment"
    });

    // stream DB rows as if they are file lines
    fhirStreamer(req, res);
};

// Returns all data on all patients
router.get("/Patient/\\$everything", [

    // The "Accept" header must be "application/fhir+ndjson". Currently we
    // don't know how to handle anything else.
    // requireNdjsonAcceptHeader,

    // The "Prefer" header must be "respond-async". Currently we don't know
    // how to handle anything else
    requireRespondAsyncHeader,

    // Validate auth token if present
    Lib.checkAuth,

    handlePatient
]);

// Provides access to all data on all patients in the nominated group
router.get("/group/:groupId/\\$everything", [

    // The "Accept" header must be "application/fhir+ndjson". Currently we
    // don't know how to handle anything else.
    // requireNdjsonAcceptHeader,

    // The "Prefer" header must be "respond-async". Currently we don't know
    // how to handle anything else
    requireRespondAsyncHeader,

    // Validate auth token if present
    Lib.checkAuth,

    handleGroup
]);

// This is the endPoint that should provide progress information
router.get("/bulkstatus", [
    Lib.checkAuth,
    extractSim,
    validateRequestStart,
    handleStatus
]);

// The actual file downloads
router.get("/bulkfiles/:file", [
    Lib.checkAuth,
    extractSim,
    handleFileDownload
]);

// host dummy conformance statement
router.get("/metadata", require("./fhir/metadata"));

// list all the groups with their IDs and the number of patients included
router.get("/Group", require("./fhir/group"));

// $get-resource-counts operation
router.get("/\\$get-resource-counts", require("./fhir/get-resource-counts"));

// operation definitions
router.use("/OperationDefinition", OpDef);


module.exports = router;
