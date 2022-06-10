import express from "express"
import { operationOutcome } from "./lib"

const router = express.Router({ mergeParams: true });

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

export default router;