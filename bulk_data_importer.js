const router      = require("express").Router({ mergeParams: true });
const bodyParser  = require("body-parser");
const Lib         = require("./lib");

var sessions = {};
var currentSession = null;

router.get("/", (req, res) => {
    res.send("router for handling bulk import requests");
});

const pollingUrl = "/byron/fhir/status";
router.get("/status", (req, res) => {
    if (sessions[currentSession]) {
        if (sessions[currentSession].importStatus == "done") {
            res.status(200);
        } else {
            res.status(202);
            res.setHeader("retry-after", 10);
            res.setHeader("x-progress", 90);
        }
        res.write("bulk data import in progress: \n");
        res.write(sessions[currentSession].inputSource);
        res.write(" ---> ")
        res.write(sessions[currentSession].importStatus);
    } else {
        res.status(204);
        res.write("no session found\n");
        res.write(Object.keys(sessions).toString());
    }
    res.end();
})

router.get("/\\$import", (req, res) => {
    res.send("$import endpoint should be accessed via POST request")
});

router.post("/\\$import", [
    // Prefer: respond-async (fixed value, required)
    Lib.requireRespondAsyncHeader,
    // Accept: application/fhir+json (fixed value, required)
    Lib.requireFhirJsonAcceptHeader,
    (req, res) => {
        // Content-Type: application/json (fixed value, required)
        if (req.headers["content-type"] != "application/json") {
            return outcomes.requireJsonContentType(res);
        }
    },
    bodyParser.json(),
    (req, res, next) => {
        const {
            // inputFormat (string, required)
            // Servers SHALL support Newline Delimited JSON with a format type
            // of application/fhir+ndjson but MAY choose to support additional
            // input formats.
            inputFormat,
            // inputSource (url, required)
            // FHIR base URL for data source. Used by the importing system when
            // matching references to previously imported data.
            inputSource,
            // storageDetail (object, optional)
            // Defaults to type of “https” with no parameters specified
            storageDetail,
            // input (json array, required)
            // array of objects containing the following fields
            input = []
        } = req.body;
        // inputFormat is required
        if (!inputFormat) {
            Lib.operationOutcome(res, 'The “inputFormat” JSON parameter is required', { httpCode: 400 });
        }
        // inputFormat must be a string
        if (typeof inputFormat != "string") {
            Lib.operationOutcome(res, 'The “inputFormat” JSON parameter must be a string', { httpCode: 400 });
        }
        // inputSource is required
        if (!inputSource) {
            Lib.operationOutcome(res, 'The “inputSource” JSON parameter is required', { httpCode: 400 });
        }
        // inputSource must be a string
        if (typeof inputSource != "string") {
            Lib.operationOutcome(res, 'The “inputSource” JSON parameter must be a string', { httpCode: 400 });
        }
        // inputSource must be an URL
        if (!inputSource.match(/^\s*https?\:\/\//i)) {
            Lib.operationOutcome(res, 'The “inputSource” JSON parameter must be an URL', { httpCode: 400 });
        }

        // create unique ID for this request
        const sessionId = Date.now(); // generate UUID
        currentSession = sessionId;
        sessions[sessionId] = req.body;
        sessions[sessionId].importStatus = "started";

        var timer = handleFileUpload(sessionId);
        // input source is present and is a URI
        return (req.body && req.body.inputSource ) ? true : false
        // construct URL for client to poll status of operation
        // const pollingUrl = base url + sessionId + something
        res.status(200); // or should this be 202?
        res.setHeader("Content-Location", pollingUrl);
        res.send("accepting POST request for bulk import (id:" + sessionId + ")");
        // send JSON response of session id and/or URL

    }
]);

async function handleRequest(req, res, groupId = null, system=false) {
    //
}

function handleFileUpload(sessionId) {
    return setTimeout( () => {
        sessions[sessionId].importStatus = "done";
        console.log("timeout completed")
    }, 6000)
}

module.exports = router;