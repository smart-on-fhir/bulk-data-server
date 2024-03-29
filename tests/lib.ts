import { Algorithm } from "jsonwebtoken";
import { Options, Response, ResponseAsJSON } from "request";

import request   from "request";
const base64url = require("base64-url");
const crypto    = require("crypto");
const jwt       = require("jsonwebtoken");
const jwkToPem  = require("jwk-to-pem");
const config    = require("../config").default;


export class RequestError extends Error
{
    response: any;

    outcome: any;

    constructor(message: string, response: any, outcome = null)
    {
        super(message);
        this.response = response;
        this.outcome = outcome;
    }
}

/**
 * Promisified version of request. Rejects with an Error or resolves with the
 * response (use response.body to access the parsed body).
 */
export function requestPromise(options: Options, delay = 0): Promise<Response> {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            request(Object.assign({ strictSSL: false }, options), (error: Error, res: Response) => {
                if (error) {
                    return reject(new RequestError(error.message, res));
                }

                let message = res.statusMessage || "Request failed";

                if (!res || !res.statusCode) {
                    return reject(new RequestError(message, res));
                }

                if (res.statusCode == 404) {
                    return reject(new RequestError("Not Found", res));
                }

                if (res.statusCode >= 400) {
                    // console.log(res.body, res.statusMessage)
                    let outcome;
                    try {
                        let body = res.body
                        if (typeof body === "string" && res.headers["content-type"]?.match(/\bjson\b/)) {
                            body = JSON.parse(body)
                        }
                        if (body.resourceType == "OperationOutcome") {
                            outcome = body;
                            message = body.issue.map(
                                (i: any) => `${i.code} ${i.severity}: ${i.diagnostics}`
                            ).join(";");
                        }
                    } catch(ex) {
                        message = String(res.body || res.statusMessage || "Unknown error!")
                    }
                    
                    return reject(new RequestError(message, res, outcome));
                }
                resolve(res);
            });
        }, delay);
    });
}

export function buildUrl(segments: (string|number)[]) {
    segments.unshift(config.baseUrl);
    return segments.map(s => String(s).trim().replace(/^\//, "").replace(/\/$/, "").trim()).join("/");
}

export function buildBulkUrl(segments: string | number | (string | number)[], params?: any) {
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

export function buildDownloadUrl(fileName: string, params: any) {
    return buildBulkUrl(["bulkfiles", fileName], params);
}

export function buildProgressUrl(params?: any) {
    return buildBulkUrl("bulkstatus", params);
}

export function buildSystemUrl(params?: any) {
    return buildBulkUrl("$export", params);
}

export function buildPatientUrl(params: any) {
    return buildBulkUrl("Patient/$export", params);
}

export function buildGroupUrl(groupId: string | number, params: any) {
    return buildBulkUrl(["Group", groupId, "$export"], params);
}

export function expectErrorOutcome(res: ResponseAsJSON, { message = "", code = 0 } = {}, done = (e?: Error) => { if (e) throw e }) {
    if (!res || !res.statusCode) {
        return done(new Error(`Received invalid response`));
    }
    if (code && res.statusCode !== code) {
        return done(new Error(`Expected ${code} statusCode but received ${res.statusCode}`));
    }
    let json = res.body;
    if (typeof json == "string") {
        try {
            json = JSON.parse(json);
        } catch(ex) {
            return done(new Error(`Error parsing body as json: ${ex}`));
        }
    }

    if (json.resourceType != "OperationOutcome") {
        return done(new Error(`Expected an OperationOutcome response but got ${json.resourceType}`));
    }

    if (message && (!json.issue || !json.issue[0] || json.issue[0].diagnostics != message)) {
        return done(new Error(`Did not return proper error message`));
    }

    done();
}

/**
 * JWKS is just an array of keys. We need to find the last private key that
 * also has a corresponding public key. The pair is recognized by having the
 * same "kid" property.
 * @param {Array} keys JWKS.keys 
 */
export function findKeyPair(keys: Record<string, any>[]) {
    let out = null;

    keys.forEach(key => {
        if (!key.kid) return;
        if (!Array.isArray(key.key_ops)) return;
        if (key.key_ops.indexOf("sign") == -1) return;

        const publicKey = keys.find(k => {
            return (
                k.kid === key.kid &&
                k.alg === key.alg &&
                Array.isArray(k.key_ops) &&
                k.key_ops.indexOf("verify") > -1
            );
        })

        if (publicKey) {
            out = { privateKey: key, publicKey };
        }
    });

    return out;
}

/**
 * Dynamically registers a backend service with the given options. Then it
 * immediately authorizes with that client and returns a promise that gets
 * resolved with the access token response.
 */
export function authorize(options: {
    alg?: Algorithm
    err?: any
    dur?: number
    scope?: string
} = {}) {
    let state: Record<string, any> = {};

    const tokenUrl = buildUrl(["auth", "token"]);
    const alg      = options.alg || "RS384"

    return requestPromise({
        url : buildUrl(["generator", "jwks"]),
        qs  : { alg },
        json: true
    })

    // Save the JWKS to the state object
    .then(res => state.jwks = res.body)

    // Save the keys to the state object
    .then(() => state.keys = findKeyPair(state.jwks.keys))

    .then(() => {
        let form: Record<string, any> = { jwks: JSON.stringify(state.jwks) };

        if (options.err) form.err = options.err;
        if (options.dur) form.dur = options.dur;

        // console.log(form)
        return requestPromise({
            method: "POST",
            url   : buildUrl(["auth", "register"]),
            json  : true,
            form
        });
    })

    .then(res => state.clientId = res.body)

    .then(() => {

        let jwtToken = {
            iss: state.clientId,
            sub: state.clientId,
            aud: tokenUrl,
            exp: Date.now()/1000 + 300, // 5 min
            jti: crypto.randomBytes(32).toString("hex")
        };

        // Convert the private JWK to PEM private key to sign with
        let privateKey = jwkToPem(state.keys.privateKey, { private: true });

        // Sign the jwt with our private key
        let signed = jwt.sign(jwtToken, privateKey, {
            algorithm: alg,
            keyid: state.keys.privateKey.kid,
            header: {
                kty: state.keys.privateKey.kty
            }
        });

        return requestPromise({
            method: "POST",
            uri   : tokenUrl,
            json  : true,
            form  : {
                scope: "scope" in options ? options.scope : "system/*.read",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: signed
            }
        });
    })
    .then(res => {return res.body})
    .catch(result => {
        // console.log(result.response.body)
        return Promise.reject(result.outcome || result.error || result)
    });
}

export function wait(ms: number) {
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    });
}

module.exports = {
    buildUrl,
    requestPromise,
    buildBulkUrl,
    buildDownloadUrl,
    buildProgressUrl,
    buildPatientUrl,
    buildSystemUrl,
    buildGroupUrl,
    expectErrorOutcome,
    authorize,
    wait
}