const router      = require("express").Router({ mergeParams: true });
const bodyParser  = require("body-parser");

var sessions = {};
var currentSession = null;

router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));

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

// router.post("/\\$import", bodyParser.json() , (req, res) => {
router.post("/\\$import", (req, res) => {
    // create unique ID for this request
    const sessionId = Date.now(); // generate UUID
    currentSession = sessionId;
    sessions[sessionId] = req.body;
    sessions[sessionId].importStatus = "started";
    var timer = handleFileUpload(sessionId);
    if (validateRequest(req)) {
        // construct URL for client to poll status of operation
        // const pollingUrl = base url + sessionId + something
        res.status(200); // or should this be 202?
        res.setHeader("Content-Location", pollingUrl);
        res.send("accepting POST request for bulk import (id:" + sessionId + ")");
        // send JSON response of session id and/or URL
    } else {
        res.status(400);
        res.send("Error: Invalid request")
    }
    // TODO: provide FHIR OperationOutcome in body
});

async function handleRequest(req, res, groupId = null, system=false) {
    //
}

function handleFileUpload(sessionId) {
    return setTimeout( () => {
        sessions[sessionId].importStatus = "done";
        console.log("timeout completed")
    }, 6000)
}

function validateRequest(req) {
    // input source is present and is a URI
    return (req.body && req.body.inputSource ) ? true : false
}

module.exports = router;