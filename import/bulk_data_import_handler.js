const router      = require("express").Router({ mergeParams: true });
const config      = require("../config");
const bodyParser  = require("body-parser");
const Lib         = require("../lib");
const {
    operationOutcome,
    outcomes
}                 = require("../outcomes");
const DownloadTaskCollection   = require("./DownloadTaskCollection");
const TaskManager = require("./TaskManager");

router.get("/", (req, res) => {
    res.send("router for handling bulk import requests");
});

const pollingBaseUrl = "/byron/fhir/status/";

router.get("/status/:taskId", (req, res) => {
    const taskId = req.params.taskId;
    
    const task = TaskManager.get(taskId)
    if (!task) {
        // missing --> 404
        res.status(404);
        res.write("no session found\n");
        // operation ouctome?
        res.end();
        return;
    }

    // task exists; check its progress

    // task finished
    let progress = task.progress
    if (progress >= 1) {
        res.status(200);
        res.json(task.toJSON())
        res.end();
        return;
    }

    // task is in progress or still starting
    res.status(202);
    // calculate interval to ask client to check back after
    // based on... current progress and elapsed time
    res.setHeader("retry-after", 100);
    res.setHeader("x-progress", progress*100 + "%");
    res.write("bulk data import in progress");
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
        // Content-Type: application/json (fixed value, required)
        if (req.headers["content-type"] != "application/json") {
            return outcomes.requireJsonContentType(res);
        }
        next();
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
            inputSource = "https",
            // storageDetail (object, optional)
            // Defaults to type of “https” with no parameters specified
            storageDetail,
            // input (json array, required)
            // array of objects containing the following fields
            input = []
        } = req.body;
        // inputFormat is required
        if (!inputFormat) {
            return operationOutcome(res, 'The “inputFormat” JSON parameter is required', { httpCode: 400 });
        }
        // inputFormat must be a string
        if (typeof inputFormat != "string") {
            return operationOutcome(res, 'The “inputFormat” JSON parameter must be a string', { httpCode: 400 });
        }
        // inputSource is required
        if (!inputSource) {
            return operationOutcome(res, 'The “inputSource” JSON parameter is required', { httpCode: 400 });
        }
        // inputSource must be a string
        if (typeof inputSource != "string") {
            return operationOutcome(res, 'The “inputSource” JSON parameter must be a string', { httpCode: 400 });
        }
        // inputSource must be an URL
        if (!inputSource.match(/^\s*https?\:\/\//i)) {
            return operationOutcome(res, 'The “inputSource” JSON parameter must be an URL', { httpCode: 400 });
        }

        // if no storageDetail, it defaults to https
        // if storageDetail is provided,
        // possible types are [https, aws-s3, gcp-bucket, azure-blob]

        // validate the request conforms to spec
        
        // support ndjson files
        // inputFormat of application/fhir+ndjson
        // (optionally support other types)
        // reject with Error Code: [500 400 406 415 418]?
        // 415 seems to describe this scenario:
        // The HTTP 415 Unsupported Media Type client error response code indicates 
        // that the server refuses to accept the request because the payload format 
        // is in an unsupported format
        if (inputFormat !== "application/fhir+ndjson") {
            return operationOutcome(
                res,
                `The server did not recognize the provided inputFormat ${inputFormat}. We currently only recognize Newline Delimited JSON with inputFormat "application/fhir+ndjson"`,
                { httpCode: 415 }
            )
        }

        // input must be an array of one or more { type, url } objects
        if (!Array.isArray(input) && !input.length) {
            return operationOutcome(res, "The input must be an array of one or more objects", { httpCode: 400 });
        }
        if (!input.every(o => typeof o.type === "string" && typeof o.url === "string")) {
            return operationOutcome(res, "Each “input” element must contain url and type", { httpCode: 400 });
        }

        console.log("request looks good ... kicking off import task manager")

        const tasks = new DownloadTaskCollection(req.body);
        TaskManager.add(tasks);
        tasks.start()
        .then(() => console.log("########################  job created with id", tasks.id));

        const pollingUrl = config.baseUrl + pollingBaseUrl + tasks.id;
        res.status(202);
        res.setHeader("Content-Location", pollingUrl);
        // optional body: FHIR OperationOutcome
        return outcomes.importAccepted(res, pollingUrl)
    }
]);

module.exports = router;