const express                = require("express");
const config                 = require("../config");
const Lib                    = require("../lib");
const DownloadTaskCollection = require("./DownloadTaskCollection");
const TaskManager            = require("./TaskManager");


const supportedStorageTypes = ["https", "aws-s3", "gcp-bucket", "azure-blob"];

const rateLimit = () => {

    const history = {};

    return function(req, res, next)
    {
        const ip  = req.ip;
        const now = Date.now();

        let rec = history[ip];
        if (!rec) {
            rec = history[ip] = {
                requests: 1,
                requestsPerMinute: 1,
                firstRequestAt: now
            };
        } else {
            
            const diff = (now - rec.firstRequestAt) / 60000;

            // If the last request was more than one minute ago, reset to
            // initial values and don't care about limits
            if (diff > 1) {
                rec.requests = 1;
                rec.requestsPerMinute = 1;
                rec.firstRequestAt = now;
                rec.violatedAt = 0;
            } else {
                rec.requestsPerMinute += 1;    
            }
        }

        // Servers SHOULD keep an accounting of status queries received from a
        // given client, and if a client is polling too frequently, the server
        // SHOULD respond with a 429 Too Many Requests status code in addition
        // to a Retry-After header, and optionally a FHIR OperationOutcome
        // resource with further explanation.
        if (rec.requestsPerMinute > config.maxRequestsPerMinute) {

            if (!rec.violatedAt) {
                rec.violatedAt = now;
            }

            // If excessively frequent status queries persist, the server MAY
            // return a 429 Too Many Requests status code and terminate the
            // session. Other standard HTTP 4XX as well as 5XX status codes may
            // be used to identify errors as mentioned.
            const violationDiff = (now - rec.violatedAt) / 1000;
            if (violationDiff > config.maxViolationDuration) {
                const taskId = req.params.taskId;
                if (taskId) {
                    TaskManager.remove(taskId);
                }
                return Lib.operationOutcome(res, 'Too many requests. Import aborted!', { httpCode: 429 });
            }


            const delay = Math.ceil((now - rec.firstRequestAt) / 1000);
            res.setHeader("Retry-After", delay);
            return Lib.operationOutcome(res, `Too many requests. Please try again in ${delay} seconds.`, { httpCode: 429 });
        }

        next();
    };
}

function validateKickOffRequestPayload(req, res, next)
{
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
        storageDetail = { type: "https" },

        // input (json array, required)
        // array of objects containing the following fields
        input

    } = req.body;

    // inputFormat is required
    if (!inputFormat) {
        return Lib.operationOutcome(res, 'The "inputFormat" JSON parameter is required', { httpCode: 400 });
    }

    // inputFormat must be a string
    if (typeof inputFormat != "string") {
        return Lib.operationOutcome(res, 'The "inputFormat" JSON parameter must be a string', { httpCode: 400 });
    }

    // inputFormat must be "application/fhir+ndjson"
    if (inputFormat !== "application/fhir+ndjson") {
        return Lib.operationOutcome(
            res,
            `The server did not recognize the provided inputFormat ${inputFormat}. We currently only recognize ` +
            `Newline Delimited JSON with inputFormat "application/fhir+ndjson"`,
            { httpCode: 415 }
        )
    }

    // inputSource is required
    if (!inputSource) {
        return Lib.operationOutcome(res, 'The "inputSource" JSON parameter is required', { httpCode: 400 });
    }

    // inputSource must be a string
    if (typeof inputSource != "string") {
        return Lib.operationOutcome(res, 'The "inputSource" JSON parameter must be a string', { httpCode: 400 });
    }

    // inputSource must be an URL
    if (!inputSource.match(/^\s*https?\:\/\//i)) {
        return Lib.operationOutcome(res, 'The "inputSource" JSON parameter must be an URL', { httpCode: 400 });
    }

    // storageDetail (it defaults to { type: "https" })
    if (storageDetail && typeof storageDetail != "object") {
        return Lib.operationOutcome(res, 'The "storageDetail" JSON parameter must be an object', { httpCode: 400 });
    }

    // storageDetail.type
    if (supportedStorageTypes.indexOf(storageDetail.type) == -1) {
        return Lib.operationOutcome(res, `The "storageDetail.type" parameter must be one of "${supportedStorageTypes.join('", "')}"`, { httpCode: 400 });
    }

    // input must be an array
    if (!Array.isArray(input)) {
        return Lib.operationOutcome(res, "The input must be an array", { httpCode: 400 });
    }

    // input cannot be empty
    if (!input.length) {
        return Lib.operationOutcome(res, "The input array cannot be empty", { httpCode: 400 });
    }

    // Validate input entries
    for (const item of input) {
        if (!item || typeof item != "object") {
            return Lib.operationOutcome(res, "All input entries must be objects", { httpCode: 400 });
        }
        if (!item.type || typeof item.type != "string") {
            return Lib.operationOutcome(res, "All input entries must have 'type' string property", { httpCode: 400 });
        }
        if (!item.url || typeof item.url != "string" || !item.url.match(/^https?\:\/\/.+/)) {
            return Lib.operationOutcome(res, "All input entries must valid 'url' property", { httpCode: 400 });
        }
    }

    next();
}

function rejectMultipleImports(req, res, next)
{
    const remainingTime = TaskManager.getRemainingTime();
    if (remainingTime !== 0) {
        // retry after remainingTime, or if that is unknown - after 10s
        res.setHeader("Retry-After", remainingTime < 0 ? 10 : Math.ceil(remainingTime / 1000));
        return Lib.operationOutcome(res, "Another import operation is currently running. Please try again later.", { httpCode: 429 });
    }

    next();
}

function cancelImport(req, res)
{
    const taskId = req.params.taskId;
    if (TaskManager.remove(taskId)) {
        return Lib.outcomes.cancelAccepted(res);
    }
    return Lib.outcomes.cancelNotFound(res);
}

function createImportKickOffHandler()
{
    return [

        // Prefer: respond-async (fixed value, required)
        Lib.requireRespondAsyncHeader,
    
        // Accept: application/fhir+json (fixed value, required)
        Lib.requireFhirJsonAcceptHeader,
    
        // Content-Type: application/json (fixed value, required)
        Lib.requireJsonContentTypeHeader,
    
        // Parse the JSON payload
        express.json(),
    
        // Validate the JSON payload
        validateKickOffRequestPayload,
    
        // Check if another import is running
        rejectMultipleImports,
    
        async (req, res, next) => {
            try {
                const tasks = new DownloadTaskCollection(req.body);
                TaskManager.add(tasks);
                await tasks.start();
                const pollingUrl = config.baseUrl + req.baseUrl + "/import-status/" + tasks.id;
                res.status(202);
                res.setHeader("Content-Location", pollingUrl);
                return Lib.outcomes.importAccepted(res, pollingUrl);
            } catch (error) {
                next(error);
            }
        }
    ];
}

function createImportStatusHandler()
{
    return [

        rateLimit(),
    
        (req, res) => {

            const task = TaskManager.get(req.params.taskId);
        
            if (!task) {
                return Lib.operationOutcome(res, 'Requested bulk import task not found', { httpCode: 404 });
            }
        
            // task exists; check its progress
            const progress = Math.max(task.progress, 0);

            // Task(s) finished
            if (progress >= 1) {
                const firstCompletedAt = Math.min(...task.tasks.map(t => t.endTime));
                const json = task.toJSON();
                res.setHeader("Expires", new Date(firstCompletedAt + config.dbMaintenanceMaxRecordAge * 1000).toUTCString());
                res.status(!json.output.length && json.error.length ? 500 : 200);
                res.json(json);
                res.end();
                return;
            }
        
            // task is in progress or still starting
            
            // set retry time based on task projected remaining time
            // but restrict max and min values to a reasonable range
            let delay;
            const remainingTime = task.remainingTime;
            const minDelay = 1 / (config.maxRequestsPerMinute / 60000);
            const maxDelay = minDelay * 2;
            if (remainingTime == -1) {
                delay = minDelay;
            } else {
                delay = Math.max(Math.min(task.remainingTime / 10, maxDelay), minDelay);
            }

            res.status(202);
            res.setHeader("retry-after", Math.ceil(delay));
            res.setHeader("x-progress", progress * 100 + "%");
            res.write("bulk data import in progress / retry interval: "+delay);
            res.end();
        }
    ];
}

module.exports = {
    createImportStatusHandler,
    cancelImport,
    createImportKickOffHandler
};