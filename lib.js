const FS        = require("fs");
const Path      = require("path");
const Walker    = require("walk");
const jwt       = require("jsonwebtoken");
const moment    = require("moment");
const config    = require("./config");
const base64url = require("base64-url");
const request   = require("request");
const { htmlEncode, outcomes, operationOutcome, createOperationOutcome }
                = require("./outcomes");

const RE_GT    = />/g;
const RE_LT    = /</g;
const RE_AMP   = /&/g;
const RE_QUOT  = /"/g;
const RE_FALSE = /^(0|no|false|off|null|undefined|NaN|)$/i;


function bool(x) {
    return !RE_FALSE.test(String(x).trim());
}

function makeArray(x) {
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
function decodeArgs(inputString) {
    let args;
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
 * @param {Object} req 
 * @param {String} paramName
 */
function getRequestedParams(req, paramName = "sim") {
    return decodeArgs(req.params[paramName]);
}

/**
 * Promisified version of readFile
 * @param {String} path 
 * @param {Object} options 
 */
async function readFile(path, options = null)
{
    return new Promise((resolve, reject) => {
        FS.readFile(path, options, (error, result) => {
            if (error) {
                return reject(error);
            }
            resolve(result);
        });
    });
}

/**
 * Parses the given json string into a JSON object. Internally it uses the
 * JSON.parse() method but adds three things to it:
 * 1. Returns a promise
 * 2. Ensures async result
 * 3. Catches errors and rejects the promise
 * @param {String} json The JSON input string
 * @return {Promise<Object>} Promises an object
 * @todo Investigate if we can drop the try/catch block and rely on the built-in
 *       error catching.
 */
async function parseJSON(json)
{
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            let out;
            try {
                out = JSON.parse(json);
            }
            catch (error) {
                return reject(error);
            }
            resolve(out);
        });
    });
}

/**
 * Serializes the given object into json if possible. Internally it uses the
 * JSON.stringify() method but adds three things to it:
 * 1. Returns a promise
 * 2. Ensures async result
 * 3. Catches errors and rejects the promise
 * @param {Object} json The JSON input object
 * @param {Function} replacer The JSON.stringify replacer function
 * @param {Number|String} indentation The The JSON.stringify indentation
 * @return {Promise<String>} Promises a string
 * @todo Investigate if we can drop the try/catch block and rely on the built-in
 *       error catching.
 * @param json 
 */
async function stringifyJSON(json, replacer = null, indentation = null)
{
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            let out;
            try {
                out = JSON.stringify(json, replacer, indentation);
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
 * @param path
 * @param {Object} options The options for readFile
 * @return {Promise<Object>} Promises the JSON object
 */
async function readJSON(path, options = null)
{
    return readFile(path, options).then(parseJSON);
}

async function forEachFile(options, cb)
{
    options = Object.assign({
        dir        : ".",
        filter     : null,
        followLinks: false,
        limit      : 0
    }, options);

    return new Promise((resolve, reject) => {
        const walker = Walker.walk(options.dir, {
            followLinks: options.followLinks
        });

        let i = 0;

        walker.on("errors", (root, nodeStatsArray, next) => {
            reject(
                new Error("Error: " + nodeStatsArray.error + root + " - ")
            );
            next();
        });

        walker.on("end", () => resolve() );

        walker.on("file", (root, fileStats, next) => {
            let path = Path.resolve(root, fileStats.name);
            if (options.filter && !options.filter(path)) {
                return next();
            }
            if (options.limit && ++i > options.limit) {
                return next();
            }
            cb(path, fileStats, next);
        });
    });
}

/**
 * Walks thru an object (ar array) and returns the value found at the
 * provided path. This function is very simple so it intentionally does not
 * support any argument polymorphism, meaning that the path can only be a
 * dot-separated string. If the path is invalid returns undefined.
 * @param {Object} obj The object (or Array) to walk through
 * @param {String} path The path (eg. "a.b.4.c")
 * @returns {*} Whatever is found in the path or undefined
 */
function getPath(obj, path = "")
{
    return path.split(".").reduce((out, key) => out ? out[key] : undefined, obj)
}

function die(error="Unknown error")
{
    console.log("\n"); // in case we have something written to stdout directly
    console.error(error);
    process.exit(1);
}

// require a valid auth token if there is an auth token
function checkAuth(req, res, next)
{
    if (req.headers.authorization) {
        let token;
        try {
            token = jwt.verify(
                req.headers.authorization.split(" ")[1],
                config.jwtSecret
            );
        } catch (e) {
            return res.status(401).send(
                `${e.name || "Error"}: ${e.message || "Invalid token"}`
            );
        }
        let error = token.err || token.sim_error || token.auth_error;
        if (error) {
            return res.status(401).send(error);
        }
    }
    else {
        if (req.sim && req.sim.secure) {
            return operationOutcome(
                res,
                "Authentication is required",
                { httpCode: 400 }
            )
        }
    }

    next();
}

function getErrorText(name, ...rest)
{
    return printf(config.errors[name], ...rest);
}

function replyWithError(res, name, code = 500, ...params)
{
    return res.status(code).send(getErrorText(name, ...params));
}

function replyWithOAuthError(res, name, options = {})
{
    const code   = options.code   || 400;
    const params = options.params || [];
    
    const defaultDescription = config.oauthErrors[name];

    if (!defaultDescription) {
        return res.status(500).send(`"${name}" is not a valid oAuth error name.`);
    }

    let message = defaultDescription;
    if (options.message) {
        if (config.errors[options.message]) {
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

/**
 * Simplified version of printf. Just replaces all the occurrences of "%s" with
 * whatever is supplied in the rest of the arguments. If no argument is supplied
 * the "%s" token is left as is.
 * @param {String} s The string to format
 * @param {*} ... The rest of the arguments are used for the replacements
 * @return {String}
 */
function printf(s)
{
    var args = arguments, l = args.length, i = 0;
    return String(s || "").replace(/(%s)/g, a => ++i > l ? "" : args[i]);
}

function buildUrlPath(...segments)
{
    return segments.map(
        s => String(s)
            .replace(/^\//, "")
            .replace(/\/$/, "")
    ).join("\/");
}

function parseToken(token)
{
    if (typeof token != "string") {
        throw new Error("The token must be a string");
    }

    token = token.split(".");

    if (token.length != 3) {
        throw new Error("Invalid token structure. Must contain 3 parts.");
    }

    // Token header ------------------------------------------------------------
    let header;
    try {
        header = JSON.parse(new Buffer(token[0], "base64"));
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
    // MUST be unique within the backend services's JWK Set.
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
    let body;
    try {
        body = JSON.parse(new Buffer(token[1], "base64"));
    } catch (ex) {
        throw new Error("Invalid token structure. Cannot parse the token body.");
    }

    return body;
}

function wait(ms = 0) {
    return new Promise(resolve => {
        if (ms) {
            setTimeout(resolve, ms);
        }
        else {
            setImmediate(resolve);
        }
    });
}

function uInt(x, defaultValue = 0) {
    x = parseInt(x + "", 10);
    if (isNaN(x) || !isFinite(x) || x < 0) {
        x = uInt(defaultValue, 0);
    }
    return x;
}

/**
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
function fhirDateTime(dateTime, noFuture) {
    let t;

    dateTime = String(dateTime || "").trim();

    // YYYY (FHIR)
    if (/^\d{4}$/.test(dateTime)) dateTime += "-01-01";

    // YYYY-MM (FHIR)
    else if (/^\d{4}-\d{2}$/.test(dateTime)) dateTime += "-01";

    // TIMESTAMP
    else if (/^\d{9,}(\.\d+)?/.test(dateTime)) dateTime *= 1;

    // Parse
    t = moment(dateTime);

    if (!t.isValid()) {
        throw new Error(`Invalid dateTime "${dateTime}"`);
    }

    if (noFuture && t.isAfter(moment())) {
        throw new Error(`Invalid dateTime "${dateTime}. Future dates are not accepted!"`);
    }

    return t.format("YYYY-MM-DD HH:mm:ss");
}

function fetchJwks(url) {
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
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function requireFhirJsonAcceptHeader(req, res, next) {
    if (req.headers.accept != "application/fhir+json") {
        return outcomes.requireAcceptFhirJson(res);
    }
    next();
}

/**
 * Simple Express middleware that will require the request to have "prefer"
 * header set to "respond-async".
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function requireRespondAsyncHeader(req, res, next) {
    if (req.headers.prefer != "respond-async") {
        return outcomes.requirePreferAsync(res);
    }
    next();
}

/**
 * Returns the absolute base URL of the given request
 * @param {object} request 
 */
function getBaseUrl(request) {
    
    // protocol
    let proto = request.headers["x-forwarded-proto"];
    if (!proto) {
        proto = request.socket.encrypted ? "https" : "http";
    }

    // host
    let host = request.headers.host;
    if (request.headers["x-forwarded-host"]) {
        host = request.headers["x-forwarded-host"];
        if (request.headers["x-forwarded-port"]) {
            host += ":" + request.headers["x-forwarded-port"];
        }
    }

    return proto + "://" + host;
}

module.exports = {
    htmlEncode,
    readFile,
    parseJSON,
    stringifyJSON,
    readJSON,
    forEachFile,
    getPath,
    operationOutcome,
    checkAuth,
    getErrorText,
    printf,
    buildUrlPath,
    replyWithError,
    replyWithOAuthError,
    parseToken,
    bool,
    wait,
    uInt,
    decodeArgs,
    getRequestedParams,
    fhirDateTime,
    createOperationOutcome,
    fetchJwks,
    makeArray,
    requireRespondAsyncHeader,
    requireFhirJsonAcceptHeader,
    getBaseUrl
};