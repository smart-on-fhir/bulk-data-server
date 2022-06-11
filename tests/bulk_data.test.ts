import fs             from "fs"
import { Options, Response, ResponseAsJSON } from "request";
import assert         from "assert"
import base64url      from "base64-url"
import moment         from "moment"
import crypto         from "crypto"
import jwkToPem, { JWK }       from "jwk-to-pem"
import jwt            from "jsonwebtoken"
import express        from "express"
import { expect }     from "chai"
const { server }    = require("../index")
import config         from "../config"
import ExportManager  from "../ExportManager"
import { wait }       from "../lib"
import * as lib       from "./lib"
import { Parameters } from "fhir/r4";
import { ExportManifest, JWKS, JWT } from "../types";

const BlueCCrossBlueShieldId = "ff7dc35f-79e9-47a0-af22-475cf301a085";


before(next => {
    server.listen(config.port, next);
});

after(next => {
    cleanUp();
    server.unref().close(next);
});

function noop() {}

function cleanUp() {
    const basePath = config.jobsPath;
    const files = fs.readdirSync(basePath);
    files.forEach(file => {
        if (file.endsWith(".json")) {
            fs.unlinkSync(basePath + "/" + file);
        }
    });
}

interface KickOffOptions {
    stu                    ?: number
    usePOST                ?: boolean
    databaseMultiplier     ?: number
    group                  ?: string
    _since                 ?: string
    systemLevel            ?: boolean
    simulatedError         ?: string
    simulatedExportDuration?: number
    resourcesPerFile       ?: number
    accessTokenLifeTime    ?: number
    _type                  ?: string
    _elements              ?: string
    _outputFormat          ?: string
    accessToken            ?: string
    extended               ?: boolean
    patient                ?: string | any[]
    accept                 ?: string | null
    prefer                 ?: string | null // = "respond-async"] The prefer header
    body                   ?: Record<string, any> // = {}
    gzip                   ?: boolean // = false]
    headers                ?: Record<string, any> // = {}
    secure                 ?: boolean
    fileError              ?: string
    del                    ?: number
    _typeFilter            ?: string
}

interface Sim {
    stu       : number
    m         : number
    dur       : number
    err       : string
    extended  : boolean
    secure    : boolean
    fileError?: string
    del      ?: number
    page     ?: number
};

interface StatusResponse extends Response {
    body: ExportManifest
}

interface ResponseWithLines extends ResponseAsJSON {
    lines: string[]
}

class Client
{
    kickOffResponse?: Response;

    statusResponse?: StatusResponse;

    /**
     * @param {object}   [options]
     * @param {boolean}  [options.systemLevel]
     * @param {string}   [options.simulatedError = ""]
     * @param {number}   [options.simulatedExportDuration = 0]
     * @param {number}   [options.resourcesPerFile]
     * @param {number}   [options.accessTokenLifeTime]
     * @param {string}   [options._type]
     * @param {string}   [options._elements]
     * @param {string}   [options._outputFormat]
     * @param {string}   [options.accessToken]
     * @param {boolean}  [options.extended = false]
     * @param {string|*[]}  [options.patient = ""]
     * @param {string|null} [options.accept = "application/fhir+json"] The accept header
     * @param {string|null} [options.prefer = "respond-async"] The prefer header
     * @param {object}   [options.body = {}]
     * @param {boolean}  [options.gzip = false]
     * @param {object}   [options.headers = {}]
     * @param {boolean}  [options.secure = false]
     * @param {string}   [options.fileError]
     * @param {number}   [options.del]
     * @param {string}   [options._typeFilter]
     */
    async kickOff(options: KickOffOptions = {})
    {
        const sim: Sim = {
            stu      : options.stu || 4,
            m        : options.databaseMultiplier || 1,
            dur      : options.simulatedExportDuration || 0,
            err      : options.simulatedError || "",
            extended : !!options.extended,
            secure   : !!options.secure,
            fileError: options.fileError,
            del      : options.del
        };

        if (options.resourcesPerFile) {
            sim.page = options.resourcesPerFile;
        }

        let segments = [
            config.baseUrl,
            base64url.encode(JSON.stringify(sim)),
            "fhir"
        ];

        if (options.systemLevel) {
            segments.push("$export");
        }
        else if (options.group) {
            segments.push(`Group/${options.group}/$export`);
        }
        else {
            segments.push("Patient/$export");
        }

        const method = options.usePOST ? "POST" : "GET";
        let body: Parameters | null = null;
        let json = false;
        const qs: Record<string, any> = {};

        if (options.usePOST) {
            json = true;

            body = {
                resourceType: "Parameters",
                parameter: []
            };

            if ("_type" in options) {
                body.parameter!.push({ name: "_type", valueString: options._type });
            }

            if ("_elements" in options) {
                body.parameter!.push({ name: "_elements", valueString: options._elements });
            }

            if ("_outputFormat" in options) {
                body.parameter!.push({ name: "_outputFormat", valueString: options._outputFormat });
            }

            if ("_since" in options) {
                body.parameter!.push({ name: "_since", valueInstant: options._since });
            }

            if ("patient" in options) {
                const arr = Array.isArray(options.patient) ?
                    options.patient :
                    String(options.patient).split(",").map(id => id.trim()).filter(Boolean);    
                
                arr.forEach(x => {
                    if (typeof x == "string") {
                        body!.parameter!.push({
                            name: "patient",
                            valueReference: {
                                reference: `Patient/${x}`
                            }
                        });
                    } else {
                        body!.parameter!.push(x);
                    }
                });
            }

            if ("_typeFilter" in options) {
                body.parameter!.push({ name: "_typeFilter", valueString: options._typeFilter });
            }
        }
        else {
            ["_since", "_type", "_elements", "patient", "_outputFormat", "_typeFilter"].forEach(key => {
                if (key in options) {
                    qs[key] = options[key as keyof typeof options];
                }
            });
        }

        const headers: Record<string, string> = {
            "accept-encoding": "identity"
        };

        if (options.accept !== null) {
            headers.Accept = options.accept || "application/fhir+json";
        }

        if (options.prefer !== null) {
            headers.Prefer = options.prefer || "respond-async";
        }

        if (options.accessToken) {
            headers.authorization = "Bearer " + options.accessToken;
        }

        const url = segments.map(s => String(s).trim().replace(/^\//, "").replace(/\/$/, "").trim()).join("/");

        this.kickOffResponse = await lib.requestPromise({
            url,
            qs,
            method,
            json,
            gzip: !!options.gzip,
            headers: { ...headers, ...(options.headers || {})},
            body: "body" in options ? options.body : body
        });

        // If the response comes as string and with content-type header
        // containing "json", parse it as JSON (might happen for custom
        // types like fhir+json)
        if (typeof this.kickOffResponse.body == "string") {
            const contentType = this.kickOffResponse.headers["content-type"] || "";
            if (contentType.indexOf("json") > -1) {
                this.kickOffResponse.body = JSON.parse(this.kickOffResponse.body);
            }
        }

        return this.kickOffResponse
    }

    async checkStatus(options: { accessToken?: string } = {}) {
        assert(this.kickOffResponse, "Trying to check the status of export that has not been started");
        
        const location = this.kickOffResponse.headers["content-location"];

        assert(location, "Trying to check the status of export that did not provide status location");

        const headers: Record<string, string> = {};

        if (options.accessToken) {
            headers.authorization = "Bearer " + options.accessToken;
        }

        this.statusResponse = await lib.requestPromise({
            url: location,
            json: true,
            headers
        });

        return this.statusResponse as StatusResponse;
    }

    getState() {
        if (!this.kickOffResponse) {
            throw new Error("Trying to check the state of export that has not been started");
        }

        const location = String(this.kickOffResponse.headers["content-location"] || "");

        let args = location.match(/^http.*?\/([^/]+)\/fhir\/bulkstatus\/(.+)/);
        if (!args || !args[2]) {
            throw new Error("Invalid content-location returned: " +
                JSON.stringify(this.kickOffResponse.headers, null, 4) + "\n\n" +
                this.kickOffResponse.body
            );
        }

        const path = `${config.jobsPath}/${args[2]}`;
        return require(path);
    }

    async waitForExport(options: Record<string, number> = {}) {
        while (true) {
            await this.checkStatus(options);
            if (this.statusResponse!.statusCode === 202) {
                await wait(100)
            } else {
                return this.statusResponse!;
            }
        }
    }

    /**
     * Starts an export and waits for it. Then downloads the file at the given
     * index. NOTE: this method assumes that the index exists and will throw
     * otherwise.
     */
    async downloadFileAt(index: number, accessToken: string | null = null, fileError: string | null = null) {
        assert(this.statusResponse?.body, "Trying to download from export that has not been completed");
        try {
            var fileUrl = this.statusResponse.body.output[index].url;
        } catch (e) {
            throw new Error(`No file was found at "output[${index}]" in the status response.`);
        }
        return await this.downloadFile(fileUrl, accessToken, fileError);
    }

    /**
     * Starts an export and waits for it. Then downloads the file at the given
     * index. NOTE: this method assumes that the index exists and will throw
     * otherwise.
     */
    async downloadFile(fileUrl: string, accessToken: string | null = null, fileError: string | null = null): Promise<ResponseWithLines> {
        if (fileError) {
            let match = fileUrl.match(/^http\:\/\/.*?\/(.*?)\/fhir/);
            assert(match && match[1], "No sim segment found in url")
            let decoded = base64url.decode(match[1])
            let sim: Sim = JSON.parse(decoded);
            sim.fileError = fileError;
            let str = base64url.encode(JSON.stringify(sim));
            fileUrl = fileUrl.replace(/^(http:\/\/.*?)\/(.*?)\/fhir/, "$1/" + str + "/fhir/");
        }

        const res = await lib.requestPromise({
            uri: fileUrl,
            // json: true,
            gzip: true,
            headers: {
                accept: "application/fhir+ndjson",
                authorization: accessToken ? `Bearer ${accessToken}` : undefined
            }
        });
        
        return {
            ...res,
            lines: String(res.body).split(/\n/).map(l => l.trim()).filter(Boolean)
        };
    }

    async cancel()
    {
        if (!this.kickOffResponse) {
            throw new Error("Trying to check the status of export that has not been started");
        }

        const url = this.kickOffResponse.headers["content-location"];

        if (!url) {
            throw new Error("Trying to check the status of export that did not provide status location");
        }

        return lib.requestPromise({ url, json: true, method: "DELETE" });
    }
}

// Begin tests =================================================================
describe("Conformance Statement", () => {
    describe("works with json types", () => {
        [
            "application/fhir+json",
            "application/json+fhir",
            "application/json",
            "text/json",
            "json"
        ].forEach(mime => {
            it (`/fhir/metadata?_format=${mime}`, () => {
                return lib.requestPromise({
                    url: lib.buildUrl([
                        `/fhir/metadata?_format=${encodeURIComponent(mime)}`
                    ])
                }).then(
                    res => expect(res.headers["content-type"]).to.equal("application/fhir+json; charset=utf-8"),
                    er => Promise.reject(`${er.error} (${er.response.body})`)
                );
            });

            it (`/fhir/metadata using accept:${mime}`, () => {
                return lib.requestPromise({
                    url: lib.buildUrl(["/fhir/metadata"]),
                    headers: { accept: mime }
                }).then(
                    res => expect(res.headers["content-type"]).to.equal("application/fhir+json; charset=utf-8"),
                    er => Promise.reject(`${er.error} (${er.response.body})`)
                );
            });

            it (`/fhir/metadata using accept:${mime};charset=UTF-8`, () => {
                return lib.requestPromise({
                    url: lib.buildUrl(["/fhir/metadata"]),
                    headers: { accept: `${mime};charset=UTF-8` }
                }).then(
                    res => {
                        // console.log(res.headers["content-type"])
                        expect(res.headers["content-type"]).to.equal("application/fhir+json; charset=utf-8")
                    },
                    er => Promise.reject(`${er.error} (${er.response.body})`)
                );
            });
        });
    });

    describe("fails with xml types", () => {
        [
            "application/fhir+xml",
            "application/xml+fhir",
            "application/xml",
            "text/xml",
            "xml"
        ].forEach(mime => {
            it (`/fhir/metadata?_format=${mime}`, () => {
                let url = lib.buildUrl([`/fhir/metadata?_format=${encodeURIComponent(mime)}`]);
                return assert.rejects(lib.requestPromise({ url }));
            });

            it (`/fhir/metadata using accept:${mime}`, () => {
                return assert.rejects(
                    lib.requestPromise({
                        url: lib.buildUrl(["/fhir/metadata"]),
                        headers: { accept: mime }
                    })
                );
            });
        });
    });
});

describe("Static", () => {
    [
        "/fhir/Group",
        "/fhir/$get-patients",
        `/fhir/$get-patients?group=${BlueCCrossBlueShieldId}`,
        "/fhir/$get-resource-counts",
        "/fhir/.well-known/smart-configuration",
        "/env.js",
        "/server-config.js",
        "/fhir/OperationDefinition",
        "/fhir/OperationDefinition/Patient--everything",
        "/fhir/OperationDefinition/Group-i-everything",
        "/fhir/OperationDefinition/-s-get-resource-counts",
    ].forEach(path => {
        it (path, () => lib.requestPromise({ url: config.baseUrl + path }));
    });

    it ("/outcome", async () => {
        const { body, statusCode } = await lib.requestPromise({
            url: config.baseUrl + "/outcome",
            json: true,
            qs: {
                httpCode: "255",
                issueCode: "my issueCode",
                severity: "my severity",
                message: "my message"
            }
        });
        // console.log(statusCode, body)
        expect(statusCode).to.equal(255);
        expect(body.issue[0].code).to.equal("my issueCode");
        expect(body.issue[0].severity).to.equal("my severity");
        expect(body.issue[0].diagnostics).to.equal("my message");
    });
});

describe("Authentication", () => {

    it ("rejects missing token if auth is required", async () => {
        const client = new Client();
        return client.kickOff({ secure: true }).then(
            () => { throw new Error("Should have failed") },
            err => {
                expect(err.response.statusCode).to.equal(401);
            }
        );
    });

    it ("rejects due to request_invalid_token error", () => assert.rejects(async() => {
        const { access_token } = await lib.authorize({ err: "request_invalid_token" });
        const client = new Client();
        await client.kickOff({ secure: true, accessToken: access_token });
    }));

    it ("rejects due to request_expired_token error", () => assert.rejects(async() => {
        const { access_token } = await lib.authorize({ err: "request_expired_token" });
        const client = new Client();
        await client.kickOff({ secure: true, accessToken: access_token });
    }));

    // it ("rejects due to bad base64 token encoding", () => assert.rejects(async() => {
    //     // const { access_token } = await lib.authorize({ err: "request_expired_token" });
    //     const client = new Client();
    //     await client.kickOff({ secure: true, accessToken: "a.b.c" });
    // }));

    describe("JWKS Auth", () => {

        const tokenUrl     = lib.buildUrl(["auth"     , "token"]);
        const generatorUrl = lib.buildUrl(["generator", "jwks"]);
        const registerUrl  = lib.buildUrl(["auth"     , "register"]);

        function authenticate(signedToken: string) {
            return lib.requestPromise({
                method: "POST",
                url   : tokenUrl,
                json  : true,
                form  : {
                    scope: "system/*.read",
                    grant_type: "client_credentials",
                    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                    client_assertion: signedToken
                }
            }).catch(ex => Promise.reject(ex.outcome || ex.error || ex));;
        }

        function register(jwksOrUrl?: string | JWKS) {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks    : jwksOrUrl && typeof jwksOrUrl == "object" ? JSON.stringify(jwksOrUrl) : undefined,
                    jwks_url: jwksOrUrl && typeof jwksOrUrl == "string" ? jwksOrUrl                 : undefined
                }
            }).catch(ex => Promise.reject(ex.outcome || ex.error || ex));
        }

        function generateKeyPair(alg: string) {
            return lib.requestPromise({
                url : generatorUrl,
                qs  : { alg },
                json: true
            }).then(resp => resp.body);
        }

        function generateAuthToken(clientId: string): JWT {
            return {
                iss: clientId,
                sub: clientId,
                aud: tokenUrl,
                exp: Date.now()/1000 + 300, // 5 min
                jti: crypto.randomBytes(32).toString("hex")
            };
        }

        function findKey(jwks: JWKS, access: string, kty: string, kid?: string) {
            return jwks.keys.find(k => {
                if (k.kty !== kty) return false;
                if (kid && k.kid !== kid) return false;
                if (!Array.isArray(k.key_ops)) return false;
                if (access == "public"  && k.key_ops.indexOf("verify") == -1) return false;
                if (access == "private" && k.key_ops.indexOf("sign"  ) == -1) return false;
                return true;
            });
        }

        function sign(jwks: JWKS, kty: string, token: JWT, jku?: string) {
            let privateKey = findKey(jwks, "private", kty) as any;
            assert(privateKey, "No private key found in jwks")
            
            return jwt.sign(token, jwkToPem(privateKey as any, { private: true }), {
                algorithm: privateKey.alg,
                keyid: privateKey.kid,
                header: { jku, kty }
            });
        }

        function hostJWKS(jwks: JWKS) {
            return new Promise(resolve => {
                const app = express();
                app.get("/jwks", (req: any, res: any) => {
                    res.json({ keys: jwks.keys.filter(k => k.key_ops.indexOf("sign") == -1) });
                });
                const server = app.listen(0, () => resolve(server));
            });
        }

        it ("Local JWKS", async () => {
            
            const jwks = { keys: [
                ...(await generateKeyPair("ES384")).keys,
                ...(await generateKeyPair("RS384")).keys
            ] }
            
            const clientId = (await register(jwks)).body
            const jwtToken = generateAuthToken(clientId)

            const RS384AccessToken = await authenticate(sign(jwks, "RSA", jwtToken))
            const ES384AccessToken = await authenticate(sign(jwks, "EC" , jwtToken))
            
            expect(!!RS384AccessToken.body).to.equal(true, "RS384AccessToken should exist")
            expect(!!ES384AccessToken.body).to.equal(true, "ES384AccessToken should exist")

        });

        it ("Hosted JWKS", () => {

            const state: Record<string, any> = {};

            return Promise.resolve()
            
            // Generate ES384 JWKS key pair
            .then(() => generateKeyPair("ES384"))

            // add the ES384 keys to our local JWKS
            .then(jwks => state.jwks = jwks)

            // Generate RS384 JWKS key pair
            .then(() => generateKeyPair("RS384"))

            // add the RS384 keys to our local JWKS
            .then(jwks => state.jwks.keys = state.jwks.keys.concat(jwks.keys))
            
            // Start a server to host the public keys
            .then(() => hostJWKS(state.jwks))

            // save the server to the state
            .then(server => state.server = server)
            
            // save the jwks_url to the state
            .then(() => state.jwks_url = `http://127.0.0.1:${state.server.address().port}/jwks`)

            // Now register a client with that augmented JWKS
            .then(() => register(state.jwks_url))

            // Save the newly generated client id to the state
            .then(res => state.clientId = res.body)

            // Generate the authentication token
            .then(() => state.jwtToken = generateAuthToken(state.clientId))

            // Find the RS384 private key, sign with it and authenticate
            .then(() => authenticate(sign(state.jwks, "RSA", state.jwtToken, state.jwks_url)))

            // Save the RS384 access token to the state
            .then(resp => state.RS384AccessToken = resp.body)

            // Now find the ES384 private key, sign with it and authenticate
            .then(() => authenticate(sign(state.jwks, "EC", state.jwtToken, state.jwks_url)))

            // Save the ES384 access token to the state
            .then(resp => state.ES384AccessToken = resp.body)
            
            // Make some checks
            .then(resp => {
                expect(!!state.RS384AccessToken).to.equal(true, "RS384AccessToken should exist");
                expect(!!state.ES384AccessToken).to.equal(true, "ES384AccessToken should exist");
            })

            // Make sure we stop the temporary server
            .then(() => state.server.close());
        });
    });
});

describe("System-level Export", function() {
    this.timeout(5000)
    it ("works", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Group,Patient", systemLevel: true });
        const { body } = await client.waitForExport();
        client.cancel();
        expect(body.output.map(x => x.type)).to.deep.equal(["Group", "Patient"]);
    });
});

describe("Bulk Data Kick-off Request", function() {
    this.timeout(5000);
    
    [
        {
            description: "/fhir/$export",
            buildUrl   : lib.buildSystemUrl,
            options: {
                systemLevel: true
            }
        },
        {
            description: "/fhir/Patient/$export",
            buildUrl   : lib.buildPatientUrl,
            options: {}
        },
        {
            description: "/:sim/fhir/Patient/$export",
            buildUrl   : (params?: any) => lib.buildPatientUrl(Object.assign({}, params || {})),
            options: {}
        },
        {
            description: "/fhir/Group/:groupId/$export",
            buildUrl   : (params?: any) => lib.buildGroupUrl(1, params),
            options: {
                group: BlueCCrossBlueShieldId
            }
        },
        {
            description: "/:sim/fhir/Group/:groupId/$export",
            buildUrl   : (params?: any) => lib.buildGroupUrl(1, Object.assign({}, params || {})),
            options: {
                group: BlueCCrossBlueShieldId
            }
        }
    ].forEach(meta => {

        function test(options: {
            sim?: Partial<Sim>
            qs?: Record<string, any>
            headers?: Record<string, any>
        }, expected: Record<string, any>) {
            return lib.requestPromise({
                uri: meta.buildUrl(options.sim || { dur: 0 }),
                qs : options.qs || {},
                json: true,
                headers: {
                    Accept: "application/fhir+json",
                    Prefer: "respond-async",
                    ...(options.headers || {})
                }
            }).then(res => {
                if (expected) {
                    let location = res.headers["content-location"] || "";
                    let args = location.match(/^http.*?\/([^/]+)\/fhir\/bulkstatus\/(.+)/);
                    if (!args || !args[2]) {
                        throw new Error("Invalid content-location returned: " + JSON.stringify(res.headers, null, 4) + "\n\n" + res.body);
                    }

                    const path = `${config.jobsPath}/${args[2]}`;
                    const state = require(path);

                    for (const key in expected) {
                        expect(state[key]).to.deep.equal(expected[key]);
                    }
                }
                return res;
            });
        }

        describe(meta.description, () => {

            describe("Accept header", () => {
                it ("Requires 'accept' header", () => assert.rejects(new Client().kickOff({ ...meta.options, accept: null })));
                it ("Works with 'accept: */*' header", () => assert.rejects(new Client().kickOff({ ...meta.options, accept: "*/*" })));
                it ("Rejects bad accept headers", () => assert.rejects(new Client().kickOff({ ...meta.options, accept: "x" })));
                it ("Accepts application/fhir+json", () => new Client().kickOff({ ...meta.options, accept: "application/fhir+json" }));
            });

            describe("Prefer header", () => {
                it ("must be provided", () => assert.rejects(new Client().kickOff({ ...meta.options, prefer: null })));
                it ("must be 'respond-async'", () => assert.rejects(new Client().kickOff({ ...meta.options, prefer: "x" })));
                it ("works if valid", async () => new Client().kickOff({ ...meta.options, prefer: "respond-async" }));
            });

            describe("_outputFormat parameter", () => {
                ["GET", "POST"].forEach(method => {
                    const options = { ...meta.options, usePOST: method === "POST" };
                    it(method + " accepts application/fhir+ndjson", async () => new Client().kickOff({ ...options, _outputFormat: "application/fhir+ndjson" }));
                    it(method + " accepts application/fhir+ndjson", async () => new Client().kickOff({ ...options, _outputFormat: "application/fhir+ndjson" }));
                    it(method + " accepts application/ndjson", async () => new Client().kickOff({ ...options, _outputFormat: "application/ndjson" }));
                    it(method + " accepts ndjson", async () => new Client().kickOff({ ...options, _outputFormat: "ndjson" }));
                    it(method + " accepts text/csv", async () => new Client().kickOff({ ...options, _outputFormat: "text/csv" }));
                    it(method + " accepts csv", async () => new Client().kickOff({ ...options, _outputFormat: "csv" }));
                    it(method + " rejects unknown", () => assert.rejects(new Client().kickOff({ ...options, _outputFormat: "x" })));
                });
            });

            describe("_type parameter", () => {
                ["GET", "POST"].forEach(method => {
                    const options = { ...meta.options, usePOST: method === "POST" };
                    it (method + " rejects invalid", () => assert.rejects(new Client().kickOff({ ...options, _type: "x,y" })));
                    it (method + " accepts valid", async () => new Client().kickOff({ ...options, _type: "Patient,Observation" }));
                });
            });

            describe("_since parameter", () => {
                ["GET", "POST"].forEach(method => {
                    const options = { ...meta.options, usePOST: method === "POST" };
                    it (method + " Rejects future _since", () => assert.rejects(new Client().kickOff({ ...options, _since: "2092-01-01T01:01:01+00:00" })));
                    it (method + " handles partial start dates like 2010", async () => new Client().kickOff({ ...options, _since: "2010" }));
                    it (method + " handles partial start dates like 2010-01", async () => new Client().kickOff({ ...options, _since: "2010-01" }));
                })
            });

            describe("_elements parameter", () => {
                ["GET", "POST"].forEach(method => {
                    const options = { ...meta.options, usePOST: method === "POST" };
                    it (method + " Rejects a.b.c", () => assert.rejects(new Client().kickOff({ ...options, _elements: "a.b.c" })));
                    it (method + " Rejects x.id", () => assert.rejects(new Client().kickOff({ ...options, _elements: "x.id" })));
                    it (method + " Rejects x-y", () => assert.rejects(new Client().kickOff({ ...options, _elements: "x-y" })));
                    it (method + " Accepts Patient.id", () => new Client().kickOff({ ...options, _elements: "Patient.id" }));
                    it (method + " Accepts Patient.id,meta", () => new Client().kickOff({ ...options, _elements: "Patient.id,meta" }));
                    it (method + " Accepts meta", () => new Client().kickOff({ ...options, _elements: "meta" }));
                });
            });

            describe("patient parameter", () => {
                it ("Rejects patient param on GET", () => assert.rejects(new Client().kickOff({ ...meta.options, patient: "a,b,c" })));
                if (meta.options.systemLevel) {
                    it ("Rejects a,b,c", () => assert.rejects(new Client().kickOff({ ...meta.options, usePOST: true, patient: "a,b,c" })));
                } else {
                    it ("Accepts a,b,c", () => new Client().kickOff({ ...meta.options, usePOST: true, patient: "a,b,c" }));
                    it ("Ignores invalid patient references", () => new Client().kickOff({
                        ...meta.options,
                        usePOST: true,
                        patient: ["a","b","c", {
                            name: "patient",
                            valueReference: {
                                text: `Some invalid reference`
                            }
                        }]
                    }));
                }
            });

            describe("POST requests", () => {
                it ("Rejects without body", () => assert.rejects(new Client().kickOff({ ...meta.options, usePOST: true, body: undefined })));
                it ("Rejects empty body", () => assert.rejects(new Client().kickOff({ ...meta.options, usePOST: true, body: {} })));
                it ("Rejects invalid body", () => assert.rejects(new Client().kickOff({ ...meta.options, usePOST: true, body: { resourceType: "whatever" } })));
            });

            describe("Access token", () => {
                it ("rejects invalid auth token", () => assert.rejects(new Client().kickOff({ ...meta.options, accessToken: "badToken" })));

                it ("accepts valid auth token", async () => {
                    const { access_token } = await lib.authorize();
                    const client = new Client();
                    await client.kickOff({
                        ...meta.options,
                        accessToken: access_token
                    });
                });
            });

            describe("Custom server parameters", () => {
                it (`passes the "dur" sim parameter thru`, () => {
                    return test({
                        sim: { dur: 2 },
                        qs : { _type: "Observation" }
                    }, {
                        simulatedExportDuration: 2
                    });
                });
    
                it (`passes the "page" sim parameter thru`, () => {
                    return test({
                        sim: { page: 2 },
                        qs : { _type: "Observation" }
                    }, {
                        resourcesPerFile: 2
                    });
                });
    
                it (`passes the "err" sim parameter thru`, () => {
                    return test({
                        sim: { err: "test" },
                        qs : { _type: "Observation" }
                    }, {
                        simulatedError: "test"
                    });
                });
    
                it (`passes the "m" sim parameter thru`, () => {
                    return test({
                        sim: { m: 2 },
                        qs : { _type: "Observation" }
                    }, {
                        databaseMultiplier: 2
                    });
                });
            
                it (`handles the the "file_generation_failed" simulated error`, done => {
                    test({
                        sim: { err: "file_generation_failed" },
                        qs : { _type: "Observation" }
                    }, {
                        simulatedError: "test"
                    }).then(
                        () => done("This request should not have succeeded!"),
                        ({ outcome }) => {
                            if (outcome.issue[0].diagnostics != "File generation failed") {
                                return done("Did not return the proper error");
                            }
                            done();
                        }
                    );
                });

                it ("Rejects invalid stu", () => assert.rejects(new Client().kickOff({ ...meta.options, stu: 9 })));
            });

            describe("_typeFilter parameter", () => {
                describe("using _filter", () => {
                    ["GET", "POST"].forEach(method => {
                        const options = { ...meta.options, usePOST: method === "POST" };
                        it ("works with " + method, async () => {
                            const client = new Client()
                            await client.kickOff({ ...options, _typeFilter: '_filter=id sw "0"' });
                            await client.cancel()
                        });
                    });
                });
            });

            it ("returns proper content-location header", done => {
                lib.requestPromise({
                    uri: meta.buildUrl(),
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                })
                .then(
                    res => {
                        let location = res.headers["content-location"] || ""
                        if (!location.match(/http.*?\/fhir\/bulkstatus\/.+$/)) {
                            return done("Invalid content-location returned: " + location);
                        }
                        done();
                    },
                    ({ error }) => done(error)
                )
            });

        });
    });
});

describe("Token endpoint", () => {
    it ("rejects missing scopes", () => assert.rejects(lib.authorize({ scope: undefined })));
    
    it ("rejects invalid V1 scopes", async () => {
        await assert.rejects(lib.authorize({ scope: "system/Patient.revoke" }))
        await assert.rejects(lib.authorize({ scope: "bad/Patient.*" }))
        await assert.rejects(lib.authorize({ scope: "user/missing.read" }))
        await assert.rejects(lib.authorize({ scope: "*/*.*" }))
    });

    it ("rejects invalid v2 scopes", async () => {
        await assert.rejects(lib.authorize({ scope: "system/ResourceType.rsx" }))
        await assert.rejects(lib.authorize({ scope: "bad/ResourceType.rs" }))
        await assert.rejects(lib.authorize({ scope: "user/missing.sd" }))
        await assert.rejects(lib.authorize({ scope: "system/ResourceType.*" }))
    });
    
    it ("does not reject valid v1 scopes", () => !assert.rejects(lib.authorize({ scope: "system/ResourceType.read" })));
    
    it ("does not reject valid v2 scopes", async () => {
        const response = await lib.authorize({ scope: "system/Patient.rs" })
        expect(response.scope).to.equal("system/Patient.rs")
    });

    it ("rejects due to bad base64 token encoding", () => assert.rejects(async() => {
        await lib.requestPromise({
            method: "POST",
            uri   : config.baseUrl + "/auth/token",
            json  : true,
            form  : {
                scope: "system/*.read",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: "a.b.c"
            }
        });
    }));

    it ("rejects due to missing alg", () => assert.rejects(async() => {
        await lib.requestPromise({
            method: "POST",
            uri   : config.baseUrl + "/auth/token",
            json  : true,
            form  : {
                scope: "system/*.read",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: base64url.encode(JSON.stringify({
                    // "typ": "JWT",
                    // "kid": "registration-token",
                    // alg: "HS256"
                })) + ".e30.A-VzgeslmP41VKnMymtGnI-qN9o61Sbj8ev_ZBPQho8"
            }
        });
    }));

    it ("rejects due to missing kid", () => assert.rejects(async() => {
        await lib.requestPromise({
            method: "POST",
            uri   : config.baseUrl + "/auth/token",
            json  : true,
            form  : {
                scope: "system/*.read",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: base64url.encode(JSON.stringify({
                    // "typ": "JWT",
                    // "kid": "registration-token",
                    alg: "HS256"
                })) + ".e30.A-VzgeslmP41VKnMymtGnI-qN9o61Sbj8ev_ZBPQho8"
            }
        });
    }));

    it ("rejects due to missing typ", () => assert.rejects(async() => {
        await lib.requestPromise({
            method: "POST",
            uri   : config.baseUrl + "/auth/token",
            json  : true,
            form  : {
                scope: "system/*.read",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: base64url.encode(JSON.stringify({
                    // "typ": "JWT",
                    kid: "registration-token",
                    alg: "HS256"
                })) + ".e30.A-VzgeslmP41VKnMymtGnI-qN9o61Sbj8ev_ZBPQho8"
            }
        });
    }));

    it ("rejects due to invalid typ", () => assert.rejects(async() => {
        await lib.requestPromise({
            method: "POST",
            uri   : config.baseUrl + "/auth/token",
            json  : true,
            form  : {
                scope: "system/*.read",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: base64url.encode(JSON.stringify({
                    typ: "JWT-X",
                    kid: "registration-token",
                    alg: "HS256"
                })) + ".e30.A-VzgeslmP41VKnMymtGnI-qN9o61Sbj8ev_ZBPQho8"
            }
        });
    }));

    it ("rejects due to bad token body", () => assert.rejects(async() => {
        await lib.requestPromise({
            method: "POST",
            uri   : config.baseUrl + "/auth/token",
            json  : true,
            form  : {
                scope: "system/*.read",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: base64url.encode(JSON.stringify({
                    typ: "JWT",
                    kid: "registration-token",
                    alg: "HS256"
                })) + "." + base64url.encode("xx") + ".A-VzgeslmP41VKnMymtGnI-qN9o61Sbj8ev_ZBPQho8"
            }
        });
    }));
})

describe("Canceling", () => {
    it ("works while exporting", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", simulatedExportDuration: 10 });
        await client.checkStatus();
        const cancelResponse = await client.cancel();
        expect(cancelResponse.body.issue[0].diagnostics).to.exist;
        expect(cancelResponse.statusCode).to.equal(202);
    });

    it ("works after export is complete", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient "});
        await client.checkStatus();
        const cancelResponse = await client.cancel();
        expect(cancelResponse.body.issue[0].diagnostics).to.exist;
        expect(cancelResponse.statusCode).to.equal(202);
    });

    it ("returns an error if trying to cancel twice", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient "});
        await client.checkStatus();
        await client.cancel();
        return client.cancel().then(
            () => { throw new Error("Should have failed"); },
            ({response}) => {
                expect(response.body.issue[0].diagnostics).to.exist;
                expect(response.statusCode).to.equal(404);
            }
        );
    });

    it ("returns an error if trying to cancel unknown request", done => {
        lib.requestPromise({ url: lib.buildProgressUrl(), method: "DELETE" })
        .then(res => {
            expect(res.body.issue[0].diagnostics).to.equal("Unknown procedure. Perhaps it is already completed and thus, it cannot be canceled")
            expect(res.statusCode).to.equal(410)
        })
        .catch(() => done())
    });

    it ("cleanUp", async () => {
        const path = config.jobsPath + "/test.json";
        fs.writeFileSync(path, `{"createdAt":${ Date.now() - config.maxExportAge * 6002 }}`, "utf8");
        expect(fs.statSync(path).isFile()).to.equal(true);
        await ExportManager.cleanUp();
        expect(() => fs.statSync(path).isFile()).to.throw;
    });

    it ("can handle deleted state files", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient" });
        const { id } = client.getState();
        fs.unlinkSync(`${config.jobsPath}/${id}.json`);
        return client.cancel().catch(({response}) => {
            expect(response.statusCode).to.equal(404);
        });
    });
});

describe("Progress Updates", function() {
    this.timeout(15000)

    it ("rejects invalid auth token", () => assert.rejects(async () => {
        const client = new Client();
        await client.kickOff();
        await client.checkStatus({ accessToken: "badToken" });
    }));

    it ("accepts valid auth token", async () => {
        const { access_token } = await lib.authorize();
        const client = new Client();
        await client.kickOff();
        await client.checkStatus({ accessToken: access_token });
    });

    it ("requires an auth token if kicked off with auth", () => assert.rejects(async () => {
        const { access_token } = await lib.authorize();
        const client = new Client();
        await client.kickOff({ accessToken: access_token });
        await client.checkStatus();
    }));

    it ("Respects the 'simulatedExportDuration' parameter", async () => {
        const client1 = new Client();
        await client1.kickOff({ simulatedExportDuration: 0 });
        await client1.waitForExport();
        expect(client1.statusResponse!.statusCode).to.equal(200);

        const client2 = new Client();
        await client2.kickOff({ simulatedExportDuration: 10 });
        await client2.checkStatus();
        expect(client2.statusResponse!.statusCode).to.equal(202);
    });

    it ("Replies with links after the wait time", async () => {
        const client = new Client();
        await client.kickOff();
        await client.waitForExport();
        expect(
            client.statusResponse!.body.output,
            `Did not reply with links array in body.output`
        ).to.be.an.instanceOf(Array);
    });

    it ("Generates correct number of links", async () => {
        const client1 = new Client();
        await client1.kickOff({ _type: "Patient", resourcesPerFile: 25 });
        await client1.waitForExport();
        expect(client1.statusResponse!.body.output.length).to.equal(4);

        const client2 = new Client();
        await client2.kickOff({ _type: "Patient", resourcesPerFile: 22, databaseMultiplier: 10 });
        await client2.waitForExport();
        expect(client2.statusResponse!.body.output.length).to.equal(46);
    });

    it ("Generates correct number of links with _filter", async () => {
        const client1 = new Client();
        await client1.kickOff({
            _type: "Patient",
            resourcesPerFile: 30,
            _typeFilter: '_filter=maritalStatus.text eq "Never Married"' // 33
        });
        await client1.waitForExport();
        // console.log(client1.statusResponse.body)
        expect(client1.statusResponse!.body.output.length).to.equal(2);
        expect(client1.statusResponse!.body.output[0].count).to.equal(30);
        expect(client1.statusResponse!.body.output[1].count).to.equal(3);

        const client2 = new Client();
        await client2.kickOff({
            _type: "Patient",
            resourcesPerFile: 100,
            _typeFilter: '_filter=maritalStatus.text eq "Never Married"', // 330
            databaseMultiplier: 10
        });
        await client2.waitForExport();
        // console.log(client1.statusResponse.body)
        expect(client2.statusResponse!.body.output.length).to.equal(4);
        expect(client2.statusResponse!.body.output[0].count).to.equal(100);
        expect(client2.statusResponse!.body.output[1].count).to.equal(100);
        expect(client2.statusResponse!.body.output[2].count).to.equal(100);
        expect(client2.statusResponse!.body.output[3].count).to.equal(30);
    });

    it ("rejects further calls on completed exports", () => assert.rejects(async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient" });
        await client.waitForExport();
        await client.checkStatus();
    }));

    it ('Generates correct "count" property for each link', async () => {
        // We have 100 patients. Using  a multiplier (`m`) of 10 and 22 records
        // per file, the result should contain 45 files of 22 resources and one
        // of 10 resources.
        const client = new Client();
        await client.kickOff({ _type: "Patient", resourcesPerFile: 22, databaseMultiplier: 10 });
        await client.waitForExport();
        
        const { output } = client.statusResponse!.body;
        const n = output.length;
        
        if (n != 46) {
            throw `Expected 46 links but got ${n}`;
        }
        
        for (let i = 0; i < n; i++) {
            if (i < 45 && output[i].count != 22) {
                throw `Expected count to equal 22 but got ${output[i].count}`;
            }
            else if (i == 45 && output[i].count != 10) {
                throw `Expected count to equal 10 for the last page but got ${output[i].count}`;
            }
        }
    });

    it ('Includes "error" property in the result', async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient" });
        await client.waitForExport();
        expect(client.statusResponse!.body.error).to.deep.equal([]);
    });

    it ("Rejects status checks on canceled exports", () => assert.rejects(async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient" });
        await client.cancel();
        await client.checkStatus();
    }));

    it ("protects against too many generated files", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Observation", resourcesPerFile: 1 });
        return client.waitForExport().then(
            () => { throw new Error("Should have failed"); },
            err => {
                expect(err.response.statusCode).to.equal(413);
                expect(err.response.body).to.equal("Too many files");
            }
        );
    });

    it ("Can simulate 'some_file_generation_failed' errors", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", resourcesPerFile: 25, simulatedError: "some_file_generation_failed" });
        await client.waitForExport();
        expect(client.statusResponse!.body.output.length).to.equal(2);
        expect(client.statusResponse!.body.error.length).to.equal(2);
    });
});

describe("File Downloading", function() {
    
    this.timeout(15000);

    it ("rejects invalid auth token", () => assert.rejects(async () => {
        const { access_token } = await lib.authorize();
        const client = new Client();
        await client.kickOff({ _type: "Patient", accessToken: access_token });
        await client.waitForExport({ accessToken: access_token });
        await client.downloadFileAt(0, "bad-token");
    }));

    it ("requires an auth token if kicked off with auth", () => assert.rejects(async () => {
        const { access_token } = await lib.authorize();
        const client = new Client();
        await client.kickOff({ _type: "Patient", accessToken: access_token });
        await client.waitForExport({ accessToken: access_token });
        await client.downloadFileAt(0);
    }));

    // Make sure that every single line contains valid JSON
    it ("Returns valid ndjson files", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient" });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        const errors: string[] = [];

        lines.forEach(line => {
            try {
                JSON.parse(line);
            } catch (e) {
                errors.push(String(e));
            }
        });

        if (errors.length) {
            throw new Error(errors.join(",\n"));
        }
    });
    
    it ("Handles the 'limit' parameter", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", resourcesPerFile: 12 });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        expect(lines.length).to.equal(12);
    });

    it ("Handles the 'offset' parameter", async () => {

        // First download 2 patients with limit=2 and no offset
        const client1 = new Client();
        await client1.kickOff({ _type: "Patient", resourcesPerFile: 2 });
        await client1.waitForExport();
        const res1 = await client1.downloadFileAt(0);
        const patient_1_2 = res1.lines[1];

        // Now add offset 1, fetch again and expect the first row to equal
        // the second one from the previous fetch
        const client2 = new Client();
        await client2.kickOff({ _type: "Patient", resourcesPerFile: 1 });
        await client2.waitForExport();
        const res2 = await client2.downloadFileAt(1);
        const patient_2_1 = res2.lines[0];

        expect(patient_1_2, "Did not shift forward").to.deep.equal(patient_2_1);
    });

    it ("Handles the 'fileError' parameter", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient" });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0, null, "whatever");
        const outcome = JSON.parse(lines[0]);
        expect(outcome.issue[0].diagnostics).to.equal("whatever");
    });

    it ("The files have the correct number of lines", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", resourcesPerFile: 2 });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(1);
        expect(lines.length).to.equal(2);
    });

    it ("can do limit and offset on Groups", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Group", systemLevel: true, resourcesPerFile: 6 });
        await client.waitForExport();
        const res1 = await client.downloadFileAt(0);
        expect(res1.lines.length).to.equal(6);
        const res2 = await client.downloadFileAt(1);
        expect(res2.lines.length).to.equal(2);
    });

    it ("can download Group files", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Group", systemLevel: true });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        expect(lines.length).to.equal(8);
    });

    it ("rejects downloads from canceled exports", () => assert.rejects(async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient" });
        await client.checkStatus();
        await client.cancel();
        await client.downloadFileAt(0);
    }));

    it ("Supports the _elements parameter", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", resourcesPerFile: 1, systemLevel: true, _elements: "birthDate" });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        const patient = JSON.parse(lines[0]);
        expect(Object.keys(patient)).to.deep.equal([
            "resourceType", "id", "identifier", "name", "gender", "birthDate", "meta"
        ]);
        expect(patient.meta.tag).to.deep.equal([{
            code: "SUBSETTED", 
            system: "http://terminology.hl7.org/CodeSystem/v3-ObservationValue"
        }]);
    });

    it ("Supports the _elements parameter on CSV", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", resourcesPerFile: 1, systemLevel: true, _elements: "id", _outputFormat: "csv" });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        expect(lines[0]).to.equal("resourceType,id,identifier,name,gender,meta");
    });

    it ("Rejects download from uncompleted exports", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", simulatedExportDuration: 10 });
        const { id } = client.getState();
        return client.downloadFile(
            config.baseUrl + "/" + base64url.encode(JSON.stringify({ id })) + "/fhir/bulkfiles/whatever"
        ).then(
            () => { throw new Error("Should have failed") },
            err => {
                expect(err.response.statusCode).to.equal(404);
            }
        );
    });

    // it ("Supports deflate downloads", async () => {
    //     const client = new Client();
    //     await client.kickOff({ _type: "Patient", gzip: false, headers: { "accept-encoding": "deflate" }});
    //     await client.checkStatus();
    //     await client.downloadFileAt(0);
    // });

    // it ("Supports gzip downloads", async () => {
    //     const client = new Client();
    //     await client.kickOff({ _type: "Patient", gzip: false, headers: { "accept-encoding": "gzip" }});
    //     await client.checkStatus();
    //     await client.downloadFileAt(0);
    // })

    it ("Handles the '_since' parameter", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", resourcesPerFile: 1, _since: "2010-01-01", extended: true });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        lines.forEach(row => {
            const json = JSON.parse(row)
            expect(moment(json.modified_date).isSameOrAfter("2010-01-01", "day")).to.equal(true)
        });
    });
    
    it ("Can simulate the 'file_missing_or_expired' error", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", simulatedError: "file_expired" });
        await client.waitForExport();
        try {
            await client.downloadFileAt(0);
        } catch (err) {
            lib.expectErrorOutcome((err as lib.RequestError).response, { code: 410 });
        }
    });

    it ("Does not download more data if the 'm' parameter is used", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", databaseMultiplier: 3, resourcesPerFile: 10 });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        expect(lines.length).to.equal(10);
    });

    it ("Does not prefix IDs on the first page", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", databaseMultiplier: 2, resourcesPerFile: 100 });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        lines.forEach(line => {
            if (/^p\d+\-/.test(JSON.parse(line).id)) {
                throw new Error(`Patient IDs are prefixed on the first page but they shouldn't`);
            }
        });
    });

    it ("Can go to virtual second page if multiplier allows it", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", databaseMultiplier: 2, resourcesPerFile: 100 });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(1);
        expect(lines.length).to.equal(100);
        lines.forEach(line => {
            expect(JSON.parse(line).id.indexOf("o2-")).to.equal(0);
        });
    });

    it ("Can go to virtual third page if multiplier allows it", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", databaseMultiplier: 3, resourcesPerFile: 100 });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(2);
        expect(lines.length).to.equal(100);
        lines.forEach(line => {
            expect(JSON.parse(line).id.indexOf("o3-")).to.equal(0);
        });
    });

    it ("Does not fetch data beyond the limits", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Patient", databaseMultiplier: 3, resourcesPerFile: 100 });
        await client.waitForExport();
        client.downloadFileAt(3).then(() => {
            throw new Error("Should have failed");
        }, noop);
    });

    it ("Handles the 'patient' parameter", async () => {
        const client = new Client();
        await client.kickOff({
            _type: "Patient",
            usePOST: true,
            patient: "6c5d9ca9-54d7-42f5-bfae-a7c19cd217f2, 58c297c4-d684-4677-8024-01131d93835e"
        });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        // console.log(lines)
        // expect(lines.length).to.equal(2);
        expect(lines.map(l => JSON.parse(l).id)).to.deep.equal([
            "6c5d9ca9-54d7-42f5-bfae-a7c19cd217f2",
            "58c297c4-d684-4677-8024-01131d93835e"
        ]);
    });

    // it ("Handles the 'm' parameter for multiplication", done => {
    //     downloadPatients({
    //         limit : 10,
    //         offset: 15
    //     })
    //     .then(patients => {
    //         let target = [
    //             'p2', // 16
    //             'p2', // 17
    //             'p2', // 18
    //             'p2', // 19
    //             'p2', // 20
    //             'p3', // 21
    //             'p3', // 22
    //             'p3', // 23
    //             'p3', // 24
    //             'p3', // 25
    //         ].join(",");
    //         let src = patients.map(p => p.id.substr(0, 2)).join(",")
    //         if (src != target) {
    //             return Promise.reject({
    //                 error: `Expected ID prefixes to equal ${target} but found ${src}`
    //             })
    //             // throw `Expected ID prefixes to equal ${target} but found ${src}`
    //         }
    //     })
    //     .then(() => done(), ({ error }) => {
    //         console.error(error);
    //         done(error)
    //     });
    // });

//     it ("Handles the virtual files properly", () => {

//         /**
//          * @param {string} resourceType The name of the resource we are testing
//          */
//         async function test(resourceType) {

//             const multiplier = 3;

//             const resourceCount = (await lib.requestPromise({
//                 url: lib.buildBulkUrl(["$get-resource-counts"]),
//                 json: true
//             })).body.parameter.find(p => p.name === resourceType).valueInteger;

//             // console.log(`${resourceType}: ${resourceCount}`);

//             const totalLines = resourceCount * multiplier;

//             // Make sure we don't truncate the file
//             const limit = totalLines + 10;

//             // The number of resources we expect to receive
//             const expectedLines = totalLines;

//             // Build the file download URL
//             const url = lib.buildDownloadUrl(`1.${resourceType}.ndjson`, {
//                 m: multiplier,
//                 limit,
//                 offset: 0
//             });

//             return lib.requestPromise({ url }).then(res => {
//                 let lines = res.body.trim().split("\n").map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l).id);

//                 // Check the expected rows length
//                 if (lines.length != expectedLines) {
//                     throw new Error(
//                         `${resourceType} - Expected ${expectedLines} lines but found ${lines.length}`
//                     );
//                 }
                
//                 // Check if the IDs are properly generated
//                 for (let i = resourceCount; i < resourceCount * 2; i++) {
//                     let expectedId = "o1-" + lines[i - resourceCount];
//                     if (lines[i] !== expectedId) {
//                         throw new Error(
//                             `Expecting the ID of line ${i} to equal "${expectedId}"`
//                         );
//                     }
//                 }
//                 for (let i = resourceCount * 2; i < resourceCount * 3; i++) {
//                     let expectedId = "o2-" + lines[i - resourceCount * 2];
//                     if (lines[i] !== expectedId) {
//                         throw new Error(
//                             `Expecting the ID of line ${i} to equal "${expectedId}"`
//                         );
//                     }
//                 }
//             });
//         }

//         return Promise.all([
//             test("AllergyIntolerance"),
//             test("Patient"),
//             test("Device"),
//             test("DocumentReference")
//         ]);

//     });

    it("Retrieval of referenced files on an open endpoint", async () => {
        const client = new Client();
        await client.kickOff({ _type: "DocumentReference" });
        await client.waitForExport();
        const { lines } = await client.downloadFileAt(0);
        for (const line of lines) {
            const doc = JSON.parse(line);
            const attachment = doc.content[0].attachment;
            const url = attachment.url;
            if (url && url.search(/https?\:\/\/.+/) === 0) {
                await lib.requestPromise({ url });
            }
        }
    });

    it("Retrieval of referenced files on an open endpoint with deletions", async () => {
        const client = new Client();
        await client.kickOff({ _type: "Device", _since: "2010-01-01T12:00:00Z", del: 10 });
        const status = await client.waitForExport();

        const deleted = status.body.deleted
        assert(Array.isArray(deleted))

        await Promise.all(
            deleted.map(file => client.downloadFile(file.url))
        )
    });
    
    it("Retrieval of referenced files on protected endpoint", async () => {
        const { access_token } = await lib.authorize();
        const client = new Client();
        await client.kickOff({ _type: "DocumentReference", accessToken: access_token });
        await client.waitForExport({ accessToken: access_token });
        const { lines } = await client.downloadFileAt(0, access_token);
        for (const line of lines) {
            const doc = JSON.parse(line);
            const attachment = doc.content[0].attachment;
            const url = attachment.url;
            if (url && url.search(/https?\:\/\/.+/) === 0) {
                await lib.requestPromise({ url, headers: { authorization: `Bearer ${access_token}`} });
            }
        }
    });
    
});


// describe("All Together", () => {

//     it ("Should download 2 valid Observation ndjson files", function(done) {

//         this.timeout(50000);

//         const TYPE = "AllergyIntolerance";

//         lib.requestPromise({
//             uri: lib.buildPatientUrl({ dur: 0, page: 20, m: 1 }),
//             qs : {
//                 _type: TYPE
//             },
//             headers: {
//                 Accept: "application/fhir+json",
//                 Prefer: "respond-async"
//             }
//         })

//         // Get the progress endpoint
//         .then(res => res.headers["content-location"])

//         // Query the progress endpoint
//         .then(statusUrl => lib.requestPromise({ uri: statusUrl, json: true }))

//         // get the download links
//         .then(res => res.body.output || [])

//         // Check the links count
//         .then(links => {
//             if (links.length != 2) {
//                 throw "Wrong number of links returned";
//             }
//             return links;
//         })

//         // convert links to URLs
//         .then(links => links.map(l => l.url))

//         // validate file names
//         .then(links => {
//             let re = /\/([^/]+)$/
//             links.forEach((l, i) => {
//                 let m = l.match(re);
//                 if (!m || !m[1]) {
//                     throw "Invalid file name";
//                 }
//                 let tokens = m[1].split(".");
//                 if (tokens.length != 3) {
//                     throw `Invalid file name "${m[1]}". Should have 3 parts`;
//                 }
//                 if (tokens[0] != i + 1) {
//                     throw `Invalid file name "${m[1]}". Should start with ${i + 1}`;
//                 }

//                 if (tokens[1] != TYPE) {
//                     throw `Invalid file name "${m[1]}". Should start with ${i + 1}.${TYPE}`;
//                 }

//                 if (tokens[2] != "ndjson") {
//                     throw `Invalid file name "${m[1]}". Should end with ".ndjson"`;
//                 }
//             });
//             return links;
//         })

//         // Check if multiple files have the same args
//         .then(links => {
//             let args1 = links[0].match(/\/bulkfiles2?\/([^/]+)/)[1];
//             let args2 = links[1].match(/\/bulkfiles2?\/([^/]+)/)[1];
//             if (args1 == args2) {
//                 throw "Same args passed to two sequential files";
//             }
//             return links;
//         })

//         // .then(links => {
//         //     links.forEach(l => console.log(l));
//         //     return links;
//         // })

//         // Do download the files
//         .then(links => Promise.all(links.map(l => lib.requestPromise({ url: l }))))

//         // Convert to JSON lines
//         .then(files => files.map(f => f.body.trim().split("\n")))

//         // Count lines
//         .then(files => {
//             let l1 = files[0].length;
//             let l2 = files[1].length;
//             if (l1 != 20) {
//                 throw `The first ${TYPE} file should have 20 lines but found ${l1}`;
//             }
//             if (l2 != 10) {
//                 throw `The second ${TYPE} file should have 10 lines but found  ${l2}`;
//             }
//             return files;
//         })

//         // look for repeated IDs
//         .then(files => {
//             let ids = {};
//             files.forEach(file => {
//                 file.forEach(row => {
//                     let r = JSON.parse(row)
//                     if (ids[r.id]) {
//                         throw `Duplicate id ${r.id} for ${r.resourceType}`
//                     }
//                     ids[r.id] = 1
//                 })
//             });
//             return files;
//         })

//         // exit
//         .then(() => done(), ({ error }) => done(error));
//     });
// });

describe("Groups", function() {
    this.timeout(5000)
    it ("Blue Cross Blue Shield should have 27 patients in the test DB", async function() {
        this.timeout(10000);

        const client = new Client();
        await client.kickOff({ _type: "Patient", group: BlueCCrossBlueShieldId });
        await client.waitForExport();
        expect(client.statusResponse!.body.output, "statusResponse.body.output must be an array").to.be.instanceOf(Array);
        expect(client.statusResponse!.body.output.length, "Wrong number of links returned").to.equal(1);
        expect(client.statusResponse!.body.output[0].url).to.match(/\/1\.Patient\.ndjson$/);
        const { lines } = await client.downloadFileAt(0);
        expect(lines.length, "Wrong number of lines").to.equal(27);
        let ids: Record<string, number> = {};
        for (const line of lines) {
            let r = JSON.parse(line);
            if (ids[r.id]) {
                throw new Error(`Duplicate id ${r.id} for ${r.type}`);
            }
            ids[r.id] = 1;
        }
    });
});

describe("Error responses", () => {

    const jwks = {
        "keys": [
            {
                "kty": "EC",
                "crv": "P-384",
                "x": "DTKkSmcxDeFkIuMLeRALzT20BfgDQ4w1nmkJu8HL6ffyYBrlmB_FC-LdRBkxx6HO",
                "y": "0LlUWTP6WWzwaPFB5fxbANDwehR6qUEY5n-V6hKtfZpVcW143UYIaMc3kEGmkXvI",
                "key_ops": [
                    "verify"
                ],
                "ext": true,
                "kid": "61a57bcf052664411ad6cab60524a840",
                "alg": "ES384"
            },
            {
                "kty": "EC",
                "crv": "P-384",
                "d": "W8nYa46Wj6_q9r8BdbQfoLufgFoeeImNWV9lhqugY15x6xI7GNPQVx2m-w31D62Y",
                "x": "DTKkSmcxDeFkIuMLeRALzT20BfgDQ4w1nmkJu8HL6ffyYBrlmB_FC-LdRBkxx6HO",
                "y": "0LlUWTP6WWzwaPFB5fxbANDwehR6qUEY5n-V6hKtfZpVcW143UYIaMc3kEGmkXvI",
                "key_ops": [
                    "sign"
                ],
                "ext": true,
                "kid": "61a57bcf052664411ad6cab60524a840",
                "alg": "ES384"
            }
        ]
    };

    // @ts-ignore
    const privateKey  = jwkToPem(jwks.keys[1], { private: true });
    const tokenUrl    = lib.buildUrl(["auth", "token"]);
    const registerUrl = lib.buildUrl(["auth", "register"]);

    function assertError(requestOptions: Options, expected?: any, code?: number, message = "") {
        return lib.requestPromise(requestOptions).then(
            () => { throw new Error("This request should have failed"); },
            result => {
                if (code && result.response.statusCode !== code) {
                    return Promise.reject(new Error(`The status code should be ${code}`));
                }

                if (expected) {
                    try {
                        assert.deepEqual(result.response.body, expected)
                    } catch (ex) {
                        return Promise.reject(new Error(
                            " The error response should equal:\n" +
                            JSON.stringify(expected, null, 2) +
                            "\n but was:\n" +
                            JSON.stringify(result.response.body, null, 2)
                        ));
                    }

                    return true
                }

                return Promise.reject(result)
            }
        )
    }

    describe("token endpoint", () => {

        it("returns 400 invalid_request with missing 'Content-type: application/x-www-form-urlencoded' header", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl
            }, {
                error            : "invalid_request",
                error_description: "Invalid request content-type header (must be 'application/x-www-form-urlencoded')"
            }, 400);
        });

        it("returns 400 invalid_grant with missing grant_type parameter", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl,
                form  : {}
            }, {
                error            : "invalid_grant",
                error_description: "Missing grant_type parameter"
            }, 400);
        });

        it("returns 400 unsupported_grant_type with invalid grant_type parameter", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl,
                form  : {
                    grant_type: "whatever"
                }
            }, {
                error: "unsupported_grant_type",
                error_description: "The grant_type parameter should equal 'client_credentials'"
            }, 400);
        });

        it("returns 400 invalid_request with missing client_assertion_type param", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl,
                form  : {
                    grant_type: "client_credentials"
                }
            }, {
                error: "invalid_request",
                error_description: "Missing client_assertion_type parameter"
            }, 400);
        });

        it("returns 400 invalid_request with invalid client_assertion_type param", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl,
                form  : {
                    grant_type           : "client_credentials",
                    client_assertion_type: "whatever"
                }
            }, {
                error: "invalid_request",
                error_description: "Invalid client_assertion_type parameter. Must be 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'."
            }, 400);
        });

        it("returns 400 invalid_request with missing invalid_client_details_token param", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl,
                form  : {
                    grant_type           : "client_credentials",
                    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
                }
            }, null, 400).catch(result => {
                expect(result.response.body.error).to.equal("invalid_request");
                expect(
                    result.response.body.error_description.indexOf("Invalid registration token: ")
                ).to.equal(0);
            });   
        });

        it("returns 400 invalid_request with invalid invalid_client_details_token param", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl,
                form  : {
                    grant_type           : "client_credentials",
                    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                    client_assertion     : "whatever"
                }
            }, null, 400).catch(result => {
                expect(result.response.body.error).to.equal("invalid_request");
                expect(
                    result.response.body.error_description.indexOf("Invalid registration token: ")
                ).to.equal(0);
            });
        });

        it("returns 400 invalid_request if the token does not contain valid client_id (sub) token", () => {
            const algorithm = jwks.keys[1].alg as jwt.Algorithm;
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl,
                form  : {
                    grant_type           : "client_credentials",
                    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                    client_assertion     : jwt.sign({ a: 1 }, privateKey, {
                        algorithm,
                        keyid    : jwks.keys[1].kid,
                        header: {
                            kty: jwks.keys[1].kty
                        }
                    })
                }
            }, null, 400).catch(result => {
                expect(result.response.body.error).to.equal("invalid_request");
                expect(
                    result.response.body.error_description.indexOf("Invalid client details token: ")
                ).to.equal(0, "The error description must begin with 'Invalid client details token: '");
            });
        });

        it("returns 400 invalid_grant if the id token contains {err:'token_expired_registration_token'}", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: JSON.stringify(jwks),
                    err: "token_expired_registration_token"
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: "Registration token expired"
                }, 400);
            })
        });

        it("returns 400 invalid_grant if the auth token 'aud' is wrong", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: JSON.stringify(jwks)
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl + "x",
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, null, 400).catch(result => {
                    expect(result.response.body.error).to.equal("invalid_grant");
                    expect(
                        result.response.body.error_description.indexOf("Invalid token 'aud' value. Must be ")
                    ).to.equal(0, `The error description must begin with 'Invalid token 'aud' value. Must be `);
                })
            })
        });

        it("returns 400 invalid_grant if the auth token 'iss' does not match the aud", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: JSON.stringify(jwks)
                }
            }).then(res => {
                return {
                    iss: "whatever",
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: `The given iss '${token.iss}' does not match the registered client_id '${token.sub}'`
                }, 400);
            })
        });

        it("returns 400 invalid_grant if the id token contains {err:'invalid_jti'}", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: JSON.stringify(jwks),
                    err: "invalid_jti"
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: "Invalid 'jti' value"
                }, 400);
            })
        });

        it("returns 400 invalid_scope if the scope is invalid", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: JSON.stringify(jwks)
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "whatever",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_scope",
                    error_description: 'Invalid scope "whatever"'
                }, 400);
            })
        });

        it("returns 400 invalid_scope if the id token contains {err:'token_invalid_scope'}", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: JSON.stringify(jwks),
                    err: "token_invalid_scope"
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_scope",
                    error_description: "Simulated invalid scope error"
                }, 400);
            })
        });

        it("returns 400 invalid_grant if the auth token jku is not whitelisted", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks_url: "my jwks_url"
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid,
                    header: {
                        jku: "whatever"
                    }
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: "The provided jku 'whatever' is different than the one used at registration time (my jwks_url)"
                }, 400);
            })
        });

        it("returns 400 invalid_grant if the jwks_url returns no keys", () => {
            function hostJWKS(jwks: any) {
                return new Promise(resolve => {
                    const app = express();
                    app.get("/jwks", (req: any, res: any) => res.json({}));
                    const server = app.listen(0, () => resolve(server));
                })
                .then((server: any) => {
                    return lib.requestPromise({
                        method: "POST",
                        url   : registerUrl,
                        json  : true,
                        form  : {
                            jwks_url: `http://127.0.0.1:${server.address().port}/jwks`
                        }
                    }).then(res => {
                        return {
                            iss: res.body,
                            sub: res.body,
                            aud: tokenUrl,
                            exp: Date.now()/1000 + 300, // 5 min
                            jti: crypto.randomBytes(32).toString("hex")
                        };
                    }).then(token => {
                        let signed = jwt.sign(token, privateKey, {
                            algorithm: jwks.keys[1].alg,
                            keyid    : jwks.keys[1].kid
                        });
        
                        return assertError({
                            method: "POST",
                            json  : true,
                            url   : tokenUrl,
                            form  : {
                                scope                : "system/*.read",
                                grant_type           : "client_credentials",
                                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                                client_assertion     : signed
                            }
                        }, {
                            error: "invalid_grant",
                            error_description: "The remote jwks object has no keys array."
                        }, 400);
                    }).then(
                        () => server.close(),
                        () => server.close()
                    );
                });
            }
        });
        
        it("returns 400 invalid_grant if local jwks has no keys", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: "{}",
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: "The registration-time jwks object has no keys array."
                }, 400);
            })
        });

        it("returns 400 invalid_grant if no jwks or jwks_url can be found", () => {
            const clientID = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InJlZ2lzdHJhdGlvbi10b2tlbiJ9.eyJhY2Nlc3NUb2tlbnNFeHBpcmVJbiI6MTUsImlhdCI6MTUzNzM2NTkwOH0.D6Hrvs50DThgB3MbprCitfg8NsDqTdr2ii68-xFs3pQ";
            return Promise.resolve({
                iss: clientID,
                sub: clientID,
                aud: tokenUrl,
                exp: Date.now()/1000 + 300, // 5 min
                jti: crypto.randomBytes(32).toString("hex")
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: "No JWKS found. No 'jku' token header is set, no " +
                        "registration-time jwks_url is available and no " +
                        "registration-time jwks is available."
                }, 400);
            })
        });

        it("returns 400 invalid_grant if no public keys can be found", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: '{"keys":[]}',
                    err: "token_invalid_token"
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid,
                    header: {
                        kty: jwks.keys[1].kty
                    }
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: `No public keys found in the JWKS with "kid" equal to "${
                        jwks.keys[1].kid
                    }"`
                }, 400);
            })
        });

        it("returns 400 invalid_grant if none of the public keys can decrypt the token", () => {
            let _jwks = {
                keys: [
                    {
                        "kty": "EC",
                        "crv": "P-384",
                        "x": "ky9AV_hLt8bjt0nO8F-uyOvkdQvvw5nwWmBqv_8uUHEz65HcfeSc1xb3d47SDNUn",
                        "y": "K0qLBg0XqC1_fp9pT7wnlUptMxRzHBCN7HJAZvxNzPabsicCo13G3ZKYLJZ2PkqJ",
                        "key_ops": [
                            "verify"
                        ],
                        "ext": true,
                        "kid": "61a57bcf052664411ad6cab60524a840",
                        "alg": "ES384"
                    }
                ]
            };

            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: JSON.stringify(_jwks)
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Math.round(Date.now()/1000) + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid,
                    header: {
                        kty: jwks.keys[1].kty
                    }
                });

                return lib.requestPromise({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                })
            }).then(
                () => {
                    throw new Error("This request should have failed");
                },
                result => {
                    assert.strictEqual(result.response.statusCode, 400);
                    assert.strictEqual(result.response.body.error, "invalid_grant", 'The "error" property should equal "invalid_grant"');
                    assert.match(result.response.body.error_description, /^Unable to verify the token with any of the public keys found in the JWKS\b/);
                }
            );
        });

        it("returns 401 invalid_client if the id token contains {err:'token_invalid_token'}", () => {
            return lib.requestPromise({
                method: "POST",
                url   : registerUrl,
                json  : true,
                form  : {
                    jwks: JSON.stringify(jwks),
                    err: "token_invalid_token"
                }
            }).then(res => {
                return {
                    iss: res.body,
                    sub: res.body,
                    aud: tokenUrl,
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                const algorithm = jwks.keys[1].alg as jwt.Algorithm;
                let signed = jwt.sign(token, privateKey, {
                    algorithm,
                    keyid    : jwks.keys[1].kid,
                    header: {
                        kty: jwks.keys[1].kty
                    }
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.read",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_client",
                    error_description: "Simulated invalid token error"
                }, 401);
            })
        });
    });

    describe("registration endpoint", () => {
        it ("returns 400 invalid_request if no 'Content-type: application/x-www-form-urlencoded' header is sent", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : registerUrl
            }, {
                error: "invalid_request",
                error_description: "Invalid request content-type header (must be 'application/x-www-form-urlencoded')"
            }, 400);
        });

        it ("returns 400 invalid_request with invalid 'dur' parameter", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : registerUrl,
                form  : {
                    dur: "test"
                }
            }, {
                error: "invalid_request",
                error_description: "Invalid dur parameter"
            }, 400);
        });

        it ("returns 400 invalid_request if both 'jwks' and 'jwks_url' are missing", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : registerUrl,
                form  : {
                    dur: 5
                }
            }, {
                error: "invalid_request",
                error_description: "Either 'jwks' or 'jwks_url' is required"
            }, 400);
        })
    });
});

