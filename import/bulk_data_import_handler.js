const router      = require("express").Router({ mergeParams: true });
const bodyParser  = require("body-parser");
const Lib         = require("../lib");
const { outcomes }    = require("../outcomes");
const DownloadTaskCollection   = require("./DownloadTaskCollection");
const DownloadTask = require("./DownloadTask");
const TaskManager = require("./TaskManager");

var sessions = {};
var currentSession = null;

router.get("/", (req, res) => {
    res.send("router for handling bulk import requests");
});

const pollingUrl = "/byron/fhir/status";

router.get("/status/:taskId", (req, res) => {
    sessionId = req.params.taskId;
    console.log("checking status of", sessionId, typeof sessionId)
    
    if (sessions[sessionId]) {
        const session = sessions[sessionId];
        if (sessions[sessionId].importStatus == "done") {
            res.status(200);
            res.write("import completed");
        } else {
            console.log("progress of", sessionId, ": ", session.job.progress)
            // undefined console.log(session.job.position)
            res.status(202);
            res.setHeader("retry-after", 10);
            res.setHeader("x-progress", 40);
            res.write("bulk data import in progress");
        }
    } else {
        // outcomes.__
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
    (req, res, next) => {
        console.log("first req handler")
        // Content-Type: application/json (fixed value, required)
        if (req.headers["content-type"] != "application/json") {
            return outcomes.requireJsonContentType(res);
        }
        next();
    },
    bodyParser.json(),
    (req, res, next) => {
        console.log("post request received")
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

        // input must be an array of one or more { type, url } objects
        if (!input.length) {
            Lib.operationOutcome(res, "The input must be an array of object(s) with url and type values", { httpCode: 400 });
        }

        console.log("request looks good...")
        // if input not array or no contents
            // each input properly formed?

            // let tasks = new DownloadTaskCollection(input);
            // create unique ID for this request
            const sessionId = Date.now().toString(); // generate UUID or random via crypto
            currentSession = sessionId;
            sessions[sessionId] = req.body; // { inputSource, inputFormat, input, storageDetail }
            sessions[sessionId].importStatus = "started";

            var tasks = startUploadTask(sessions[sessionId]);
            
            console.log("session id created", sessionId, typeof sessionId)
            
        res.status(202);
        res.setHeader("Content-Location", pollingUrl + "/" + sessionId);
        res.send("accepting POST request for bulk import (id:" + sessionId + ")");
    }
]);

async function handleRequest(req, res, groupId = null, system=false) {
    //
}

function startUploadTask(session) {
    // session.job = new DownloadTaskCollection(session.input); // tasks;
    session.job = new DownloadTask(session.input[0])
    process.stdout.write("collection created ... from " + session.input[0].url + " ... ")
    TaskManager.add(session.job)
    process.stdout.write("added to task manager ... ")
    session.job.start()
    process.stdout.write("and job started\n")
}

module.exports = router;