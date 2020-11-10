const express      = require("express");
const cors         = require("cors");
const Lib          = require("./lib");
const OpDef        = require("./fhir/OperationDefinition/index");
const bulkImporter = require("./import/bulk_data_import_handler");
const ExportManager = require("./ExportManager");


const router = express.Router({ mergeParams: true });

const jsonTypes = [
    "application/json",
    "application/fhir+json",
    "application/json+fhir"
];

// Start helper express middlewares --------------------------------------------
function extractSim(req, res, next) {
    req.sim = Lib.getRequestedParams(req);
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
    .post(express.json({ type: jsonTypes }))
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
    .post(express.json({ type: jsonTypes }))
    .all(
        extractSim,
        Lib.requireFhirJsonAcceptHeader,
        Lib.requireRespondAsyncHeader,
        Lib.checkAuth,
        ExportManager.createKickOffHandler()
    );

// This is the endPoint that should provide progress information
router.get("/bulkstatus/:id", [
    Lib.checkAuth,
    ExportManager.createStatusHandler()
]);

// The actual file downloads 
router.get("/bulkfiles/:file", [
    extractSim,
    Lib.checkAuth,
    ExportManager.createDownloadHandler()
]);

router.delete("/bulkstatus/:id", [
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

// Kick-off import
router.post("/\\$import", bulkImporter.createImportKickOffHandler());

// =============================================================================
// FHIR/Other Endpoints
// =============================================================================

// host dummy conformance statement
router.get("/metadata", cors({ origin: true }), extractSim, require("./fhir/metadata"));

// list all the groups with their IDs and the number of patients included
router.get("/Group", cors({ origin: true }), require("./fhir/group"));

router.get("/\\$get-patients", cors({ origin: true }), require("./fhir/patient"));

// $get-resource-counts operation
router.get("/\\$get-resource-counts", cors({ origin: true }), require("./fhir/get-resource-counts"));

// operation definitions
router.use("/OperationDefinition", cors({ origin: true }), OpDef);

// router.get("/files/", Lib.checkAuth, express.static(__dirname + "/attachments"));
router.use('/attachments', cors({ origin: true }), Lib.checkAuth, express.static(__dirname + "/attachments"));


module.exports = router;
