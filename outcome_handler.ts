import express from "express"
import { operationOutcome, uInt } from "./lib"

const router = express.Router({ mergeParams: true });

// Results of DownloadTaskCollection contain encoded URL 
// for each attempted file import at this "/outcome" endpoint:
// respond to request with a FHIR OperationOutcome in JSON format
router.get("/", (req, res) => {
    const message   = String(req.query.message || "No details available");
    const httpCode  = uInt(req.query.httpCode, 500);
    const issueCode = String(req.query.issueCode);
    const severity  = String(req.query.severity || "error") as any;
    return operationOutcome(res, message, { httpCode, issueCode, severity });
})

export default router;