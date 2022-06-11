import { NextFunction, Request, Response } from "express"
import FS                                  from "fs/promises"
import Path                                from "path"
import jwt, { Algorithm }                  from "jsonwebtoken"
import moment                              from "moment"
import base64url                           from "base64-url"
import request                             from "request"
import { format }                          from "util"
import FHIR, { OperationOutcome }          from "fhir/r4"
import { Dirent }                          from "fs"
import config                              from "./config"
import getDB                               from "./db"
import { JSONValue }                       from "./types"


const RE_GT    = />/g;
const RE_LT    = /</g;
const RE_AMP   = /&/g;
const RE_QUOT  = /"/g;
const RE_FALSE = /^(0|no|false|off|null|undefined|NaN|)$/i;


export function bool(x: any): boolean {
    return !RE_FALSE.test(String(x).trim());
}

export function htmlEncode(html: string): string {
    return String(html)
        .trim()
        .replace(RE_AMP , "&amp;")
        .replace(RE_LT  , "&lt;")
        .replace(RE_GT  , "&gt;")
        .replace(RE_QUOT, "&quot;");
}

export function operationOutcome(
    res: Response,
    message: string,
    options: {
        httpCode?: number,
        severity?: "fatal" | "error" | "warning" | "information",
        issueCode?: string
    } = {})
{
    return res.status(options.httpCode || 500).json(
        createOperationOutcome(message, options)
    );
}

export function createOperationOutcome(message: string, {
        issueCode = "processing", // http://hl7.org/fhir/valueset-issue-type.html
        severity  = "error"       // fatal | error | warning | information
    }: {
        issueCode?: string
        severity?: "fatal" | "error" | "warning" | "information"
    } = {}): OperationOutcome
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

export function makeArray(x: any[]): typeof x;
export function makeArray(x: string): any[];
export function makeArray(x: any): [typeof x];
export function makeArray(x: any): any[] {
    if (Array.isArray(x)) {
        return x;
    }
    if (typeof x == "string") {
        return x.trim().split(/\s*,\s*/);
    }
    return [x];
}

/**
 * This will parse and return the JSON contained within a base64-encoded string
 * @param {String} inputString Base64url-encoded string
 * @returns {Object}
 */
export function decodeArgs(inputString: string): Record<string, any> {
    let args: any = {};
    try {
        args = JSON.parse(base64url.decode(inputString));
    }
    catch(ex) {
        args = null;
    }
    finally {
        if (!args || typeof args !== "object") {
            args = {};
        }
    }
    return args;
}

/**
 * This will parse and return the JSON contained within a base64-encoded route
 * fragment. Given a request object and a paramName, this function will look for
 * route parameter with that name and parse it to JSON and return the result
 * object. If anything goes wrong, an empty object will be returned.
 */
export function getRequestedParams(req: Request, paramName = "sim") {
    return decodeArgs(req.params[paramName]);
}

/**
 * Parses the given json string into a JSON object. Internally it uses the
 * JSON.parse() method but adds three things to it:
 * 1. Returns a promise
 * 2. Ensures async result
 * 3. Catches errors and rejects the promise
 */
export async function parseJSON<T=JSONValue>(json: string): Promise<T>
{
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            try {
                var out = JSON.parse(json || "null");
            }
            catch (error) {
                return reject(error);
            }
            resolve(out as T);
        });
    });
}

/**
 * Serializes the given object into json if possible. Internally it uses the
 * JSON.stringify() method but adds three things to it:
 * 1. Returns a promise
 * 2. Ensures async result
 * 3. Catches errors and rejects the promise
 */
export async function stringifyJSON(json: JSONValue, indentation?: string | number): Promise<string>
{
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            try {
                var out = JSON.stringify(json, null, indentation);
            }
            catch (error) {
                return reject(error);
            }
            resolve(out);
        });
    });
}

/**
 * Read a file and parse it as JSON.
 */
export async function readJSON<T=JSONValue>(path: string): Promise<T>
{
    return FS.readFile(path, "utf8").then(json => parseJSON<T>(json));
}

export async function forEachFile(options: {
    dir    : string,
    limit ?: number,
    filter?: (path: string, dirent: Dirent) => boolean | undefined
}, cb: (path: string, dirent: Dirent) => any) {
    try {
        const dir = await FS.opendir(options.dir);
        let i = 0;
        for await (const dirent of dir) {
            if (options.limit && ++i > options.limit) {
                continue;
            }
            if (dirent.isFile()) {
                const path = Path.join(options.dir, dirent.name);
                if (options.filter && !options.filter(path, dirent)) {
                    continue;
                }    
                await cb(path, dirent);
            }
        }
    } catch (err) {
        console.error(err);
    }
}

/**
 * Walks thru an object (ar array) and returns the value found at the
 * provided path. This function is very simple so it intentionally does not
 * support any argument polymorphism, meaning that the path can only be a
 * dot-separated string. If the path is invalid returns undefined.
 * @param obj The object (or Array) to walk through
 * @param path The path (eg. "a.b.4.c")
 * @returns Whatever is found in the path or undefined
 */
export function getPath(obj: any, path = ""): any
{
    return path.split(".").reduce((out, key) => out ? out[key] : undefined, obj)
}

// require a valid auth token if there is an auth token
export function checkAuth(req: Request, res: Response, next: NextFunction)
{
    if (req.headers.authorization) {
        try {
            var token = jwt.verify(
                req.headers.authorization.split(" ")[1],
                config.jwtSecret,
                {
                    algorithms: config.supportedSigningAlgorithms as Algorithm[]
                }
            );
        } catch (e) {
            return operationOutcome(
                res,
                "Invalid token " + (e as Error).message,
                { httpCode: 401 }
            );
        }
        // @ts-ignore
        let error = token.err || token.sim_error || token.auth_error;
        if (error) {
            return res.status(401).send(error);
        }
    }
    else {
        if ((req as any).sim && (req as any).sim.secure) {
            return operationOutcome(
                res,
                "Authentication is required",
                { httpCode: 401 }
            )
        }
    }

    next();
}

export function getErrorText(name: keyof typeof config.errors, ...rest: any[])
{
    return format(config.errors[name], ...rest);
}

export function replyWithError(res: Response, name: keyof typeof config.errors, code = 500, ...params: any[])
{
    return res.status(code).send(getErrorText(name, ...params));
}

export function replyWithOAuthError(res: Response, name: keyof typeof config.oauthErrors, options: {
    code?: number
    message?: string
    params?: any[]
} = {})
{
    const code   = options.code   || 400;
    const params = options.params || [];
    
    const defaultDescription = config.oauthErrors[name];

    if (!defaultDescription) {
        return res.status(500).send(`"${name}" is not a valid oAuth error name.`);
    }

    let message = defaultDescription;
    if (options.message) {
        // @ts-ignore
        if (config.errors[options.message]) {
            // @ts-ignore
            message = getErrorText(options.message, ...params);
        }
        else {
            message = options.message;
        }
    }
    
    return res.status(code).json({
        error: name,
        error_description: message
    });
}

export function buildUrlPath(...segments: string[])
{
    return segments.map(
        s => String(s)
            .replace(/^\//, "")
            .replace(/\/$/, "")
    ).join("\/");
}

export function parseToken(t: string)
{
    if (typeof t != "string") {
        throw new Error("The token must be a string");
    }

    let token = t.split(".");

    if (token.length != 3) {
        throw new Error("Invalid token structure. Must contain 3 parts.");
    }

    // Token header ------------------------------------------------------------
    try {
        var header = JSON.parse(Buffer.from(token[0], "base64").toString("utf8"));
    } catch (ex) {
        throw new Error("Invalid token structure. Cannot parse the token header.");
    }

    // alg (required) ----------------------------------------------------------
    // algorithm used for signing the authentication JWT (e.g., `RS384`, `EC384`).
    if (!header.alg) {
        throw new Error("Invalid JWT token header. Missing 'alg' property.");
    }

    // kid (required) ----------------------------------------------------------
    // The identifier of the key-pair used to sign this JWT. This identifier
    // MUST be unique within the backend service's JWK Set.
    if (!header.kid) {
        throw new Error("Invalid JWT token header. Missing 'kid' property.");
    }

    // typ (required) ----------------------------------------------------------
    // Fixed value: JWT.
    if (!header.typ) {
        throw new Error("Invalid JWT token header. Missing 'typ' property.");
    }
    
    if (header.typ != "JWT") {
        throw new Error("Invalid JWT token header.The 'typ' property must equal 'JWT'.");
    }

    // Token body --------------------------------------------------------------
    try {
        var body = JSON.parse(Buffer.from(token[1], "base64").toString("utf8"));
    } catch (ex) {
        throw new Error("Invalid token structure. Cannot parse the token body.");
    }

    return body;
}

export function getGrantedScopes(req: Request): {system: string, resource: string, action: string}[] {
    try {
        const accessToken = jwt.verify((req.headers.authorization || "").replace(/^bearer\s+/i, ""), config.jwtSecret, {
            algorithms: config.supportedSigningAlgorithms as Algorithm[]
        })
        // @ts-ignore jwt.verify returns string | object but for JWK we know it is an object
        return scopeSet(accessToken.scope)
    } catch {
        return []
    }
}

export function hasAccessToResourceType(
    grantedScopes: {system: string, resource: string, action: string}[],
    resourceType: string,
    access = "read"
): boolean {
    return grantedScopes.some(scope => (
        (scope.system === "*" || scope.system === "system") &&
        (scope.resource === "*" || scope.resource === resourceType) &&
        (scope.action === "*" || scope.action === access)
    ))
}

export function wait(ms = 0) {
    return new Promise(resolve => {
        setTimeout(resolve, uInt(ms));
    });
}

export function uInt(x: any, defaultValue = 0): number {
    x = parseInt(x + "", 10);
    if (isNaN(x) || !isFinite(x) || x < 0) {
        x = uInt(defaultValue, 0);
    }
    return x;
}

/**
 * @param dateTime Either a date/dateTime string or a timestamp number
 * @see https://momentjs.com/docs/#/parsing/ for the possible date-time
 * formats.
 * 
 * A dateTime string can be in any of the following formats in SQLite:
 *  YYYY-MM-DD
 *  YYYY-MM-DD HH:MM
 *  YYYY-MM-DD HH:MM:SS
 *  YYYY-MM-DD HH:MM:SS.SSS
 *  YYYY-MM-DDTHH:MM
 *  YYYY-MM-DDTHH:MM:SS
 *  YYYY-MM-DDTHH:MM:SS.SSS
 *  now
 *  DDDDDDDDDD
 */
export function fhirDateTime(dateTime: string | number, noFuture?: boolean) {
    
    dateTime = String(dateTime || "").trim();

    // YYYY (FHIR)
    if (/^\d{4}$/.test(dateTime)) dateTime += "-01-01";

    // YYYY-MM (FHIR)
    else if (/^\d{4}-\d{2}$/.test(dateTime)) dateTime += "-01";

    // TIMESTAMP
    else if (/^\d{9,}(\.\d+)?/.test(dateTime)) dateTime = +dateTime;

    // Parse
    let t = moment(dateTime);

    if (!t.isValid()) {
        throw new Error(`Invalid dateTime "${dateTime}"`);
    }

    if (noFuture && t.isAfter(moment())) {
        throw new Error(`Invalid dateTime "${dateTime}. Future dates are not accepted!"`);
    }

    return t.format("YYYY-MM-DD HH:mm:ss");
}

export function fetchJwks(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        request({ url, json: true }, (error, resp, body) => {
            if (error) {
                return reject(error);
            }

            if (resp.statusCode >= 400) {
                return reject(new Error(
                    `Requesting "${url}" returned ${resp.statusCode} status code`
                ));
            }

            // if (resp.headers["content-type"].indexOf("json") == -1) {
            //     return reject(new Error(
            //         `Requesting "${url}" did not return a JSON content-type`
            //     ));
            // }

            resolve(body);
        });
    });
}

/**
 * Simple Express middleware that will require the request to have "accept"
 * header set to "application/fhir+ndjson".
 */
export function requireFhirJsonAcceptHeader(req: Request, res: Response, next: NextFunction) {
    if (req.headers.accept != "application/fhir+json") {
        return outcomes.requireAcceptFhirJson(res);
    }
    next();
}

/**
 * Simple Express middleware that will require the request to have "prefer"
 * header set to "respond-async".
 */
export function requireRespondAsyncHeader(req: Request, res: Response, next: NextFunction) {
    const tokens = String(req.headers.prefer || "").trim().split(/\s*[,;]\s*/);
    if (!tokens.includes("respond-async")) {
        return outcomes.requirePreferAsync(res);
    }
    next();
}

/**
 * Simple Express middleware that will require the request to have "Content-Type"
 * header set to "application/json".
 */
export function requireJsonContentTypeHeader(req: Request, res: Response, next: NextFunction) {
    if (!req.is("application/json")) {
        return outcomes.requireJsonContentType(res);
    }
    next();
}

/**
 * Get a list of all the resource types present in the database
 */
export function getAvailableResourceTypes(fhirVersion: number): Promise<string[]> {
    const DB = getDB(fhirVersion);
    return DB.promise("all", 'SELECT DISTINCT "fhir_type" FROM "data"')
        .then((rows: any[]) => rows.map(row => row.fhir_type));
}

export function tagResource(resource: Partial<FHIR.Resource>, code: string, system = "https://smarthealthit.org/tags")
{
    if (!resource.meta) {
        resource.meta = {};
    }

    if (!Array.isArray(resource.meta.tag)) {
        resource.meta.tag = [];
    }

    const tag = resource.meta.tag.find(x => x.system === system);
    if (tag) {
        tag.code = code;
    } else {
        resource.meta.tag.push({ system, code });
    }
}

/**
 * Parses a scopes string and returns an array of {system, resource, action}
 * objects
 */
export function scopeSet(scopes: string): {system: string, resource: string, action: string}[] {
    return scopes.trim().split(/\s+/).map(s => {
        const [system, resource, action] = s.split(/\/|\./)
        return {
            system,
            resource,
            action,
            toString() {
                return `${this.system}/${this.resource}.${this.action}`;
            }
        }
    }) 
}

/**
 * Checks if the given scopes string is valid for use by backend services.
 * This will only accept system scopes and will also reject empty scope.
 * @param scopes The scopes to check
 * @param [fhirVersion] The FHIR version that this scope should be
 * validated against. If provided, the scope should match one of the resource
 * types available in the database for that version (or *). Otherwise no
 * check is performed.
 * @returns The invalid scope or empty string on success
 * @static
 */
export async function getInvalidSystemScopes(scopes: string, fhirVersion: number): Promise<string> {
    scopes = String(scopes || "").trim();

    if (!scopes) {
        return config.errors.missing_scope;
    }

    const scopesArray = scopes.split(/\s+/);

    // If no FHIR version is specified accept anything that looks like a
    // resource
    let availableResources = "[A-Z][A-Za-z0-9]+";

    // Otherwise check the DB to see what types of resources we have
    if (fhirVersion) {
        availableResources = (await getAvailableResourceTypes(fhirVersion)).join("|");
    }

    const re = new RegExp("^system/(\\*|" + availableResources + ")(\\.(read|write|\\*))?$");
    return scopesArray.find(s => !(re.test(s))) || "";
}

// Errors as operationOutcome responses
export const outcomes = {
    fileExpired: (res: Response) => operationOutcome(
        res,
        "Access to the target resource is no longer available at the server " +
        "and this condition is likely to be permanent because the file " +
        "expired",
        { httpCode: 410 }
    ),
    invalidAccept: (res: Response, accept: string) => operationOutcome(
        res,
        `Invalid Accept header "${accept}". Currently we only recognize ` +
        `"application/fhir+ndjson" and "application/fhir+json"`,
        { httpCode: 400 }
    ),
    invalidSinceParameter: (res: Response, value: any) => operationOutcome(
        res,
        `Invalid _since parameter "${value}". It must be valid FHIR instant and ` +
        `cannot be a date in the future"`,
        { httpCode: 400 }
    ),
    requireJsonContentType: (res: Response) => operationOutcome(
        res,
        "The Content-Type header must be application/json",
        { httpCode: 400 }
    ),
    requireAcceptFhirJson: (res: Response) => operationOutcome(
        res,
        "The Accept header must be application/fhir+json",
        { httpCode: 400 }
    ),
    requirePreferAsync: (res: Response) => operationOutcome(
        res,
        "The Prefer header must be respond-async",
        { httpCode: 400 }
    ),
    fileGenerationFailed: (res: Response) => operationOutcome(
        res,
        getErrorText("file_generation_failed")
    ),
    cancelAccepted: (res: Response) => operationOutcome(
        res,
        "The procedure was canceled",
        { severity: "information", httpCode: 202 /* Accepted */ }
    ),
    cancelCompleted: (res: Response) => operationOutcome(
        res,
        "The export was already completed",
        { httpCode: 404 }
    ),
    cancelNotFound: (res: Response) => operationOutcome(
        res,
        "Unknown procedure. Perhaps it is already completed and thus, it cannot be canceled",
        { httpCode: 404 /* Not Found */ }
    ),
    importAccepted: (res: Response, location: string) => operationOutcome(
        res,
        `Your request has been accepted. You can check its status at "${location}"`,
        { httpCode: 202, severity: "information" }
    ),
    exportAccepted: (res: Response, location: string) => operationOutcome(
        res,
        `Your request has been accepted. You can check its status at "${location}"`,
        { httpCode: 202, severity: "information" }
    ),
    exportDeleted: (res: Response) => operationOutcome(
        res,
        "The exported resources have been deleted",
        { httpCode: 404 }
    ),
    exportNotCompleted: (res: Response) => operationOutcome(
        res,
        "The export is not completed yet",
        { httpCode: 404 }
    )
};

/**
 * Make Promise abortable with the given signal.
 */
export function abortablePromise<T=any>(p: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(new AbortError("Already aborted"));
    }

    return new Promise((resolve, reject) => {
        const abort = () => reject(new AbortError());
        signal.addEventListener("abort", abort, { once: true });
        return p.then(resolve).finally(() => signal.removeEventListener("abort", abort));
    });
}

export class AbortError extends Error {
    constructor(message = "Aborted") {
        super(message)
    }
}
