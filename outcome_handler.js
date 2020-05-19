const router                = require("express").Router({ mergeParams: true });
const { operationOutcome }  = require("./lib");

// Results of DownloadTaskCollection contain encoded URL 
// for each attempted file import at this "/outcome" endpoint:
// respond to request with a FHIR OperationOutcome in JSON format
router.get("/", (req, res) => {
    const message = req.query.message || "No details available";
    const httpCode = req.query.httpCode || 500;
    const issueCode = req.query.issueCode;
    const severity = req.query.severity || "error";
    return operationOutcome(res, message, { httpCode, issueCode, severity });
})

module.exports = router;