import express, { Request, Response }   from "express"
import { NextFunction, RequestHandler } from "express-serve-static-core"
import cors              from "cors"
import * as Lib          from "./lib"
import OpDef             from "./fhir/OperationDefinition/index"
import bulkImporter      from "./import/bulk_data_import_handler"
import ExportManager     from "./ExportManager"
import metadata          from "./fhir/metadata"
import * as group        from "./fhir/group"
import getResourceCounts from "./fhir/get-resource-counts"
import patient           from "./fhir/patient"
import wellKnown         from "./fhir/wellKnownSmartConfiguration"


const router = express.Router({ mergeParams: true });

const jsonTypes = [
    "application/json",
    "application/fhir+json",
    "application/json+fhir"
];

// Start helper express middlewares --------------------------------------------
function extractSim(req: Request, res: Response, next: NextFunction) {
    (req as any).sim = Lib.getRequestedParams(req);
    next();
}

// =============================================================================
// BulkData Export Endpoints
// =============================================================================

// System Level Export
// Export data from a FHIR server whether or not it is associated with a patient.
// This supports use cases like backing up a server or exporting terminology
// data by restricting the resources returned using the _type parameter.
router.route("/\\$export")
    .post(express.json({ type: jsonTypes }) as RequestHandler)
    .all(
        extractSim,
        Lib.requireFhirJsonAcceptHeader,
        Lib.requireRespondAsyncHeader,
        Lib.checkAuth,
        ExportManager.createKickOffHandler(true)
    );

// /Patient/$export - Returns all data on all patients
// /$export - does the same on this server because we don't
router.route(["/Patient/\\$export", "/group/:groupId/\\$export"])
    .post(express.json({ type: jsonTypes }) as RequestHandler)
    .all(
        extractSim,
        Lib.requireFhirJsonAcceptHeader,
        Lib.requireRespondAsyncHeader,
        Lib.checkAuth,
        ExportManager.createKickOffHandler()
    );

// This is the endPoint that should provide progress information
router.get("/bulkstatus/:id", [Lib.checkAuth, ExportManager.createStatusHandler()]);

// The actual file downloads 
router.get("/bulkfiles/:file", [
    extractSim,
    Lib.checkAuth,
    ExportManager.createDownloadHandler()
]);

router.delete("/bulkstatus/:id", [
    extractSim,
    Lib.checkAuth,
    ExportManager.createCancelHandler()
]);

// =============================================================================
// BulkData Import Endpoints
// =============================================================================

// Return import progress by task id generated during kick-off request
// and provide time interval for client to wait before checking again
router.get("/import-status/:taskId", bulkImporter.createImportStatusHandler());

// Stop an import that has not completed
router.delete("/import-status/:taskId", bulkImporter.cancelImport);

// @ts-ignore Kick-off import
router.post("/\\$import", bulkImporter.createImportKickOffHandler());

// =============================================================================
// FHIR/Other Endpoints
// =============================================================================

// host dummy well-known statement
router.get("/.well-known/smart-configuration", cors({ origin: true }), extractSim, wellKnown);

// host dummy conformance statement
router.get("/metadata", cors({ origin: true }), extractSim, metadata);

// list all the groups with their IDs and the number of patients included
router.get("/Group", cors({ origin: true }), group.getAll);

// list groups with by ID
router.get("/Group/:id", cors({ origin: true }), group.getOne);

router.get("/\\$get-patients", cors({ origin: true }), patient);

// $get-resource-counts operation
router.get("/\\$get-resource-counts", cors({ origin: true }), getResourceCounts);

// operation definitions
router.use("/OperationDefinition", cors({ origin: true }), OpDef);

// router.get("/files/", Lib.checkAuth, express.static(__dirname + "/attachments"));
router.use('/attachments', cors({ origin: true }), extractSim, Lib.checkAuth, express.static(__dirname + "/attachments"));


export default router;
