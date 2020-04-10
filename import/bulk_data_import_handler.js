const router      = require("express").Router({ mergeParams: true });
const bodyParser  = require("body-parser");
const Lib         = require("../lib");
const { outcomes }    = require("../outcomes");
const DownloadTaskCollection   = require("./DownloadTaskCollection");
const TaskManager = require("./TaskManager");

router.get("/", (req, res) => {
    res.send("router for handling bulk import requests");
});

const pollingUrl = "/byron/fhir/status";

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

        console.log("request looks good ... kicking off import task manager")
        // if input not array or no contents
            // each input properly formed?

        const tasks = new DownloadTaskCollection(req.body);
        TaskManager.add(tasks);
        tasks.start()
        .then(() => console.log("########################  job created with id", tasks.id));
            
        res.status(202);
        // use config.baseUrl + "/" + ...
        res.setHeader("Content-Location", pollingUrl + "/" + tasks.id);
        res.end();
    }
]);

module.exports = router;