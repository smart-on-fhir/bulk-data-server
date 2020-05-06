const router                = require("express").Router({ mergeParams: true });
const { operationOutcome }  = require("./lib");

// DownloadTaskCollection provides result containing URL 
// for each attempted file import at this endpoint
// that should generate the result as FHIR OperationOutcome
router.get("/", (req, res) => {
    const message = req.query.message || "No details available";
    return operationOutcome(
        res,
        message,
        {
            httpCode: 200,
            issueCode: req.query.issueCode,
            severity: req.query.severity
        }
    );
})

module.exports = router;