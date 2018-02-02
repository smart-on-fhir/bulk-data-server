const request   = require("request");
const base64url = require("base64-url");
const crypto    = require("crypto");
const jwt       = require("jsonwebtoken");
const config    = require("../config");

/**
 * Promisified version of request. Rejects with an Error or resolves with the
 * response (use response.body to access the parsed body).
 * @param {Object} options The request options
 * @param {Number} delay [0] Delay in milliseconds
 * @return {Promise<Object>}
 */
function requestPromise(options, delay = 0) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            request(Object.assign({ strictSSL: false }, options), (error, res) => {
                if (error) {
                    return reject(error);
                }
                if (res.statusCode >= 400) {
                    return reject(res.body || res.statusMessage);
                }
                resolve(res);
            });
        }, delay);
    });
}

function buildUrl(segments) {
    segments.unshift(config.baseUrl);
    return segments.map(s => String(s).trim().replace(/^\//, "").replace(/\/$/, "").trim()).join("/");
}

function buildBulkUrl(segments, params) {
    let url = []
    if (params) {
        url.push(base64url.encode(JSON.stringify(params)));
    }
    url.push("fhir");
    if (!Array.isArray(segments)) {
        segments = [segments]
    }
    url = url.concat(segments);
    return buildUrl(url);
}

function buildDownloadUrl(fileName, params) {
    return buildBulkUrl(["bulkfiles", fileName], params);
}

function buildProgressUrl(params) {
    return buildBulkUrl("bulkstatus", params);
}

function buildPatientUrl(params) {
    return buildBulkUrl("Patient/$export", params);
}

function buildGroupUrl(groupId, params) {
    return buildBulkUrl(["Group", groupId, "$export"], params);
}

function expectErrorOutcome(res, { message, code } = {}, done) {
    if (code && res.statusCode !== code) {
        return done(`Expected ${code} statusCode but received ${res.statusCode}`);
    }
    let json = res.body;
    if (typeof json == "string") {
        try {
            json = JSON.parse(json);
        } catch(ex) {
            return done(`Error parsing body as json: ${ex}`);
        }
    }

    if (json.resourceType != "OperationOutcome") {
        return done(`Expected an OperationOutcome response but got ${json.resourceType}`);
    }

    if (message && (!json.issue || !json.issue[0] || json.issue[0].diagnostics != message)) {
        return done(`Did not return proper error message`);
    }

    done();
}

/**
 * Dynamically registers a backend service with the given options. Then it
 * immediately authorizes with that client and returns a promise that gets
 * resolved with the access token response.
 * @param {Object} options
 * @param {Number} options.accessTokenLifeTime
 * @param {String} options.simulatedError
 * @returns {Promise<Object>}
 */
function authorize(options = {}) {
    let state = {};

    const iss = "tester"
    const tokenUrl = buildUrl(["auth", "token"]);

    return requestPromise({
        url: buildUrl(["generator", "rsa"]),
        qs: {
            enc: "base64"
        },
        json: true
    })

    .then(res => { state.keys = res.body })
    
    .then(() => {
        let form = {
            iss,
            pub_key: state.keys.publicKey
        };

        if (options.err) form.err = options.err;
        if (options.dur) form.dur = options.dur;

        // pub_key: state.keys.publicKey
        return requestPromise({
            method: "POST",
            url   : buildUrl(["auth", "register"]),
            json  : true,
            form
        });
    })

    .then(res => { state.clientId = res.body })

    .then(() => {
        
        let jwtToken = {
            iss,
            sub: state.clientId,
            aud: tokenUrl,
            exp: Date.now()/1000 + 300, // 5 min
            jti: crypto.randomBytes(32).toString("hex")
        };

        return requestPromise({
            method: "POST",
            url   : tokenUrl,
            json  : true,
            form  : {
                scope: "system/*.*",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: jwt.sign(
                    jwtToken,
                    base64url.decode(state.keys.privateKey),
                    { algorithm: 'RS256'}
                )
            }
        })
    })
    
    .then(res => res.body);
}

module.exports = {
    buildUrl,
    requestPromise,
    buildBulkUrl,
    buildDownloadUrl,
    buildProgressUrl,
    buildPatientUrl,
    buildGroupUrl,
    expectErrorOutcome,
    authorize
}