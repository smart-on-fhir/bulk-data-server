import { OperationOutcome } from "fhir/r4";
import { Algorithm }        from "jsonwebtoken";
const base64url = require("base64-url");
const crypto    = require("crypto");
const jwt       = require("jsonwebtoken");
const jwkToPem  = require("jwk-to-pem");
const config    = require("../config").default;


export class RequestError extends Error
{
    [key: string]: any;

    constructor(message: string, props: Record<string, any>)
    {
        super(message);
        Object.assign(this, props)
    }
}

export interface FetchResponse<T=string | object> {
    response: globalThis.Response
    parsedBody: T
}

export async function request<T=string | object>(url: string | URL, options?: RequestInit): Promise<FetchResponse<T>> {
    const response = await fetch(url, options)
    
    let message = response.statusText || "Request failed";

    let type = response.headers.get("Content-Type") + "";

    let out = {
        response,
        parsedBody: await response.text()
    }

    if (out.parsedBody.length && type.match(/\bjson\b/i)) {
        out.parsedBody = JSON.parse(out.parsedBody);
    }

    if (response.status >= 400) {
        try {
            const outcome = out.parsedBody as unknown as OperationOutcome
            if (outcome.resourceType == "OperationOutcome") {
                message = outcome.issue.map(
                    (i: any) => `${i.code} ${i.severity}: ${i.diagnostics}`
                ).join(";");
            }
        } catch(ex) {
            message = String(out.parsedBody || response.statusText || "Unknown error!")
        }
        
        throw new RequestError(message, out);
    }

    if (!response.ok) {
        throw new RequestError(message, out);
    }
    
    return out as FetchResponse<T>;
}

export function buildUrl(segments: (string|number)[], query?: Record<string, any>) {
    segments.unshift(config.baseUrl);
    let url = segments.map(s => String(s).trim().replace(/^\//, "").replace(/\/$/, "").trim()).join("/");
    if (query) {
        url += "?" + Object.keys(query).map(k => k + "=" + encodeURIComponent(query[k])).join("&")
    }
    return url
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

    return request(buildUrl(["generator", "jwks"], { alg }))

    // Save the JWKS to the state object
    .then(res => state.jwks = res.parsedBody)

    // Save the keys to the state object
    .then(() => state.keys = findKeyPair(state.jwks.keys))

    .then(() => {
        const body = new URLSearchParams()
        body.append("jwks", JSON.stringify(state.jwks));

        if (options.err) body.append("err", options.err);
        if (options.dur) body.append("dur", options.dur + "");

        // console.log(body)
        return request(buildUrl(["auth", "register"]), {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body
        })
    })

    .then(res => state.clientId = res.parsedBody)

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

        const body = new URLSearchParams()
        body.set("scope", options.scope ?? "system/*.read")
        body.set("grant_type", "client_credentials")
        body.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer")
        body.set("client_assertion", signed)

        return request(tokenUrl, {
            method : "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body
        });
    })
    .then(res => res.parsedBody as any)
    .catch(result => {
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
    request,
    buildBulkUrl,
    buildDownloadUrl,
    buildProgressUrl,
    buildPatientUrl,
    buildSystemUrl,
    buildGroupUrl,
    authorize,
    RequestError,
    wait
}