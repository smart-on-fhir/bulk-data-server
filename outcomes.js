const RE_GT    = />/g;
const RE_LT    = /</g;
const RE_AMP   = /&/g;
const RE_QUOT  = /"/g;

function htmlEncode(html) {
    return String(html)
        .trim()
        .replace(RE_AMP , "&amp;")
        .replace(RE_LT  , "&lt;")
        .replace(RE_GT  , "&gt;")
        .replace(RE_QUOT, "&quot;");
}

function operationOutcome(res, message, options = {}) {
    return res.status(options.httpCode || 500).json(
        createOperationOutcome(message, options)
    );
}

function createOperationOutcome(message, {
        httpCode  = 500,
        issueCode = "processing", // http://hl7.org/fhir/valueset-issue-type.html
        severity  = "error"       // fatal | error | warning | information
    } = {})
{
    return {
        "resourceType": "OperationOutcome",
        "text": {
            "status": "generated",
            "div": `<div xmlns="http://www.w3.org/1999/xhtml">` +
            `<h1>Operation Outcome</h1><table border="0"><tr>` +
            `<td style="font-weight:bold;">${severity}</td><td>[]</td>` +
            `<td><pre>${htmlEncode(message)}</pre></td></tr></table></div>`
        },
        "issue": [
            {
                "severity"   : severity,
                "code"       : issueCode,
                "diagnostics": message
            }
        ]
    };
}



// Errors as operationOutcome responses
const outcomes = {
    fileExpired: res => operationOutcome(
        res,
        "Access to the target resource is no longer available at the server " +
        "and this condition is likely to be permanent because the file " +
        "expired",
        { httpCode: 410 }
    ),
    noContent: res => operationOutcome(
        res,
        "No Content - your query did not match any fhir resources",
        { httpCode: 204 }
    ),
    invalidAccept: (res, accept) => operationOutcome(
        res,
        `Invalid Accept header "${accept}". Currently we only recognize ` +
        `"application/fhir+ndjson" and "application/fhir+json"`,
        { httpCode: 400 }
    ),
    invalidOutputFormat: (res, value) => operationOutcome(
        res,
        `Invalid output-format parameter "${value}". Currently we only ` +
        `recognize "application/fhir+ndjson", "application/ndjson" and "ndjson"`,
        { httpCode: 400 }
    ),
    invalidSinceParameter: (res, value) => operationOutcome(
        res,
        `Invalid _since parameter "${value}". It must be valid FHIR instant and ` +
        `cannot be a date in the future"`,
        { httpCode: 400 }
    ),
    requireJsonContentType: res => operationOutcome(
        res,
        "The Content-Type header must be application/json",
        { httpCode: 400 }
    ),
    requireAcceptFhirJson: res => operationOutcome(
        res,
        "The Accept header must be application/fhir+json",
        { httpCode: 400 }
    ),
    requirePreferAsync: res => operationOutcome(
        res,
        "The Prefer header must be respond-async",
        { httpCode: 400 }
    ),
    requireRequestStart: res => operationOutcome(
        res,
        "The request start time parameter (requestStart) is missing " +
        "in the encoded params",
        { httpCode: 400 }
    ),
    invalidRequestStart: (req, res) => operationOutcome(
        res,
        `The request start time parameter (requestStart: ${
        req.sim.requestStart}) is invalid`,
        { httpCode: 400 }
    ),
    invalidResourceType: (res, resourceType) => operationOutcome(
        res,
        `The requested resource type "${resourceType}" is not available on this server`,
        { httpCode: 400 }
    ),
    futureRequestStart: res => operationOutcome(
        res,
        "The request start time parameter (requestStart) must be " +
        "a date in the past",
        { httpCode: 400 }
    ),
    fileGenerationFailed: res => operationOutcome(
        res,
        Lib.getErrorText("file_generation_failed")
    ),
    canceled: res => operationOutcome(
        res,
        "The procedure was canceled by the client and is no longer available",
        { httpCode: 410 /* Gone */ }
    ),
    cancelAccepted: res => operationOutcome(
        res,
        "The procedure was canceled",
        { severity: "information", httpCode: 202 /* Accepted */ }
    ),
    cancelGone: res => operationOutcome(
        res,
        "The procedure was already canceled by the client",
        { httpCode: 410 /* Gone */ }
    ),
    cancelNotFound: res => operationOutcome(
        res,
        "Unknown procedure. Perhaps it is already completed and thus, it cannot be canceled",
        { httpCode: 404 /* Not Found */ }
    ),
    onlyNDJsonAccept: res => operationOutcome(
        res,
        "Only application/fhir+ndjson is currently supported for accept headers",
        { httpCode: 400 }
    ),
    importAccepted: (res, location) => operationOutcome(
        res,
        `Your request has been accepted. You can check it's status at "${location}"`,
        { httpCode: 202, severity: "information" }
    ),
    exportAccepted: (res, location) => operationOutcome(
        res,
        `Your request has been accepted. You can check it's status at "${location}"`,
        { httpCode: 202, severity: "information" }
    )
};

module.exports = {
    outcomes,
    htmlEncode,
    operationOutcome,
    createOperationOutcome
}