const request   = require("request");
const base64url = require("base64-url");
const moment    = require("moment");
const assert    = require("assert");
const crypto    = require("crypto");
const jwkToPem  = require("jwk-to-pem");
const jwt       = require("jsonwebtoken");
const express   = require("express");
const lib       = require("./lib");
const app       = require("../index");
const config    = require("../config");

let server;
before(next => {
    server = app.listen(config.port, () => next());
});

after(next => {
    if (server) {
        server.close();
        server = null;
    }
    next();
});

// added in node v10
async function rejects(block, error, message) {
    let promise = block;
    if (typeof block == "function") {
        try {
            promise = block();
        } catch (ex) {
            return Promise.reject(ex);
        }
    }
    if (!promise || typeof promise.then != "function") {
        return Promise.reject(new Error(
            "The first argument must be a Promise or a function " +
            "that returns a promise"
        ));
    }

    let result;
    try {
        result = await promise;
    } catch (ex) {
        if (error) {
            if (typeof error == "function") {
                if (!(ex instanceof error)) {
                    return Promise.reject(new Error(
                        `Expected block to reject with an instance of ${error.name}`    
                    ));
                }
            //     else if ()
            }
            else if (typeof error == "object") {
                for (let key in error) {
                    assert.ok(
                        error[key] === ex[key],
                        `Expected the rejection error to have a "${key}" ` +
                        `property equal to '${error[key]}'`
                    )
                }
            }
        }
        return Promise.resolve();
    }
    return Promise.reject(new Error(message || "The provided block did not reject"));
}

function downloadPatients(options) {
    let url = lib.buildDownloadUrl("1.Patient.ndjson", options);
    return lib.requestPromise({ url })
        .then(res => res.body.split("\n").filter(r => !!r).map(row => {
            try {
                return JSON.parse(row)
            } catch (ex) {
                console.log("rows: '" + res.body + "'");
                throw ex;
            }
        }));
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
                });
            });

            it (`/fhir/metadata using accept:${mime}`, () => {
                return lib.requestPromise({
                    url: lib.buildUrl(["/fhir/metadata"]),
                    headers: { accept: mime }
                });
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
                return rejects(lib.requestPromise({ url }));
            });

            it (`/fhir/metadata using accept:${mime}`, () => {
                return rejects(
                    lib.requestPromise({
                        url: lib.buildUrl(["/fhir/metadata"]),
                        headers: { accept: mime }
                    })
                );
            });
        });
    });
});

describe("JWKS Auth", () => {

    const tokenUrl     = lib.buildUrl(["auth"     , "token"]);
    const generatorUrl = lib.buildUrl(["generator", "jwks"]);
    const registerUrl  = lib.buildUrl(["auth"     , "register"]);

    function authenticate(signedToken) {
        return lib.requestPromise({
            method: "POST",
            url   : tokenUrl,
            json  : true,
            form  : {
                scope: "system/*.*",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: signedToken
            }
        }).catch(ex => Promise.reject(ex.outcome || ex.error || ex));;
    }

    function register(jwks) {
        return lib.requestPromise({
            method: "POST",
            url   : registerUrl,
            json  : true,
            form  : {
                jwks    : jwks && typeof jwks == "object" ? JSON.stringify(jwks) : undefined,
                jwks_url: jwks && typeof jwks == "string" ? jwks                 : undefined
            }
        }).catch(ex => Promise.reject(ex.outcome || ex.error || ex));
    }

    function generateKeyPair(alg) {
        return lib.requestPromise({
            url : generatorUrl,
            qs  : { alg },
            json: true
        }).then(resp => resp.body);
    }

    function generateAuthToken(clientId) {
        return {
            iss: clientId,
            sub: clientId,
            aud: tokenUrl,
            exp: Date.now()/1000 + 300, // 5 min
            jti: crypto.randomBytes(32).toString("hex")
        };
    }

    function findKey(jwks, access, kty, kid) {
        return jwks.keys.find(k => {
            if (k.kty !== kty) return false;
            if (kid && k.kid !== kid) return false;
            if (!Array.isArray(k.key_ops)) return false;
            if (access == "public" && k.key_ops.indexOf("verify") == -1) return false;
            if (access == "private" && k.key_ops.indexOf("sign") == -1) return false;
            return true;
        });
    }

    function sign(jwks, kty, token, jku) {
        let privateKey = findKey(jwks, "private", kty);
        return jwt.sign(
            token,
            jwkToPem(privateKey, { private: true }),
            {
                algorithm: privateKey.alg,
                keyid: privateKey.kid,
                header: { jku, kty }
            }
        );
    }

    function hostJWKS(jwks) {
        return new Promise(resolve => {
            const app = express();
            app.get("/jwks", (req, res) => {
                res.json({ keys: jwks.keys.filter(k => k.key_ops.indexOf("sign") == -1) });
            });
            const server = app.listen(0, () => resolve(server));
        });
    }

    it ("Local JWKS", () => {
        
        const state = {};

        return Promise.resolve()
        
        // Generate ES384 JWKS key pair
        .then(() => generateKeyPair("ES384"))

        // add the ES384 keys to our local JWKS
        .then(jwks => state.jwks = jwks)

        // Generate RS384 JWKS key pair
        .then(() => generateKeyPair("RS384"))

        // add the RS384 keys to our local JWKS
        .then(jwks => state.jwks.keys = state.jwks.keys.concat(jwks.keys))
        
        // Now register a client with that augmented JWKS
        .then(() => register(state.jwks))

        // Save the newly generated client id to the state
        .then(res => state.clientId = res.body)

        // Generate the authentication token
        .then(() => state.jwtToken = generateAuthToken(state.clientId))

        // Find the RS384 private key, sign with it and authenticate
        .then(() => authenticate(sign(state.jwks, "RSA", state.jwtToken)))

        // Save the RS384 access token to the state
        .then(resp => state.RS384AccessToken = resp.body)

        // Now find the ES384 private key, sign with it and authenticate
        .then(() => authenticate(sign(state.jwks, "EC", state.jwtToken)))

        // Save the ES384 access token to the state
        .then(resp => state.ES384AccessToken = resp.body)
        
        // Make some checks
        .then(resp => {
            assert.ok(state.RS384AccessToken, "RS384AccessToken should exist");
            assert.ok(state.ES384AccessToken, "ES384AccessToken should exist");
        });

    });

    it ("Hosted JWKS", () => {

        const state = {};

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
            assert.ok(state.RS384AccessToken, "RS384AccessToken should exist");
            assert.ok(state.ES384AccessToken, "ES384AccessToken should exist");
        })

        // Make sure we stop the temporary server
        .then(() => state.server.close());
    });
});

describe("System-level Export", () => {
    it ("works", done => {
        
        lib.requestPromise({
            uri: lib.buildSystemUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                dur         : 0
            }),
            qs : {
                _type: "Group,Patient"
            },
            headers: {
                Accept: "application/fhir+json",
                Prefer: "respond-async"
            }
        })
        .then(res => res.headers["content-location"])
        .then(uri => lib.requestPromise({ uri }))
        .then(res => JSON.parse(res.body))
        .then(json => json.output)
        .then(links => links.find(l => l.type == "Group"))
        .then(link => {
            if (!link) {
                throw new Error("No Group files returned");
            }
            return lib.requestPromise({ url: link.url });
        })
        .then(res => res.body.trim().split("\n"))
        .then(lines => {
            if (lines.length != 8) {
                throw new Error(`Expected 8 lines but got ${lines.length}`)
            }
            return lines.map(l => JSON.parse(l))
        })
        .then(() => done())
        .catch(done);
    });
});

describe("Bulk Data Kick-off Request", () => {
    [
        {
            description: "/fhir/$export",
            buildUrl   : lib.buildSystemUrl
        },
        {
            description: "/fhir/Patient/$export",
            buildUrl   : lib.buildPatientUrl
        },
        {
            description: "/:sim/fhir/Patient/$export",
            buildUrl   : params => lib.buildPatientUrl(Object.assign({}, params || {}))
        },
        {
            description: "/fhir/Group/:groupId/$export",
            buildUrl   : params => lib.buildGroupUrl(1, params)
        },
        {
            description: "/:sim/fhir/Group/:groupId/$export",
            buildUrl   : params => lib.buildGroupUrl(1, Object.assign({}, params || {}))
        }
    ].forEach(meta => {
        describe(meta.description, () => {
            
            it ("rejects invalid auth token", () => rejects(
                lib.requestPromise({
                    uri: meta.buildUrl(),
                    headers: {
                        authorization: "Bearer badToken"
                    }
                })
            ));

            it ("accepts valid auth token", () => {
                return lib.authorize()
                .then(tokenResponse => lib.requestPromise({
                    uri: meta.buildUrl(),
                    headers: {
                        authorization: "Bearer " + tokenResponse.access_token,
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                }))
                .catch(result => Promise.reject(result.outcome || result.error || result));
            });

            it ("requires valid 'Accept' header", () => rejects(
                lib.requestPromise({
                    uri: meta.buildUrl(),
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                })
                .then(() => lib.requestPromise({
                    uri: meta.buildUrl(),
                    headers: {
                        Accept: "bad-header",
                        Prefer: "respond-async"
                    }
                }))
            ));

            it ("requires 'Prefer: respond-async' header", done => {
                request({
                    uri: meta.buildUrl(),
                    headers: {
                        Accept: "application/fhir+json"
                    }
                }, (error, res) => {
                    if (error) {
                        return done(error);
                    }
                    lib.expectErrorOutcome(res, {
                        message: "The Prefer header must be respond-async",
                        code   : 400
                    }, done)
                });
            });

            it ("validates the '_outputFormat' parameter", done => {
                lib.requestPromise({
                    uri: meta.buildUrl(),
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                })
                .then(() => lib.requestPromise({
                    uri: meta.buildUrl() + "?_outputFormat=application%2Ffhir%2Bndjson",
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                }))
                .then(() => lib.requestPromise({
                    uri: meta.buildUrl() + "?_outputFormat=application%2Fndjson",
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                }))
                .then(() => lib.requestPromise({
                    uri: meta.buildUrl() + "?_outputFormat=ndjson",
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                }))
                .then(() => lib.requestPromise({
                    uri: meta.buildUrl() + "?_outputFormat=test",
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                }).catch(err => 1))

                .then(() => done(), ({ error }) => done(error));
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
                        if (!location.match(/http.*?\/fhir\/bulkstatus$/)) {
                            return done("Invalid content-location returned: " + location);
                        }
                        done();
                    },
                    ({ error }) => done(error)
                )
            });

            it (`handles the "_type" and "_since" query parameter`, done => {
                const TYPE = "Observation", START = "2010-01-01", EXPECTED = "2010-01-01 00:00:00";
                lib.requestPromise({
                    uri: meta.buildUrl({ dur: 1 }),
                    qs : {
                        _type: TYPE,
                        _since: START
                    },
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                })
                .then(
                    res => {
                        let location = res.headers["content-location"] || "";
                        let args = location.match(/^http.*?\/([^/]+)\/fhir\/bulkstatus/);
                        if (!args || !args[1]) {
                            return done("Invalid content-location returned: " + JSON.stringify(res.headers, null, 4) + "\n\n" + res.body);
                        }
                        
                        try {
                            args = JSON.parse(base64url.decode(args[1]));
                        } catch (ex) {
                            
                            return done(ex);
                        }
        
                        if (args.type != TYPE) {
                            return done(`Expected type param to equal "${TYPE}" but found "${args.type}"`);
                        }
                        if (args.start != EXPECTED) {
                            return done(`Expected "start" param to equal "${EXPECTED}" but found "${args.start}"`);
                        }
                        done();
                    },
                    ({ error }) => done(error)
                )
            });

            it (`handles partial start dates like 2010`, done => {
                const TYPE = "Observation",
                    IN = "2010",
                    EXPECTED = "2010-01-01 00:00:00";
                lib.requestPromise({
                    uri: meta.buildUrl({ dur: 1 }),
                    qs : {
                        _type: TYPE,
                        _since: IN
                    },
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                })
                .then(
                    res => {
                        let location = res.headers["content-location"] || "";
                        let args = location.match(/^http.*?\/([^/]+)\/fhir\/bulkstatus/);
                        try {
                            args = JSON.parse(base64url.decode(args[1]));
                        } catch (ex) {
                            return done(ex);
                        }

                        if (args.start != EXPECTED) {
                            return done(`Expected "start" param to equal "${EXPECTED}" but found "${args.start}"`);
                        }

                        done();
                    },
                    ({ error }) => done(error)
                )
            });

            it (`handles partial start dates like 2010-01`, done => {
                const TYPE = "Observation",
                    IN = "2010-01",
                    EXPECTED = "2010-01-01 00:00:00";
                lib.requestPromise({
                    uri: meta.buildUrl({ dur: 1 }),
                    qs : {
                        _type: TYPE,
                        _since: IN
                    },
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                })
                .then(
                    res => {
                        let location = res.headers["content-location"] || "";
                        let args = location.match(/^http.*?\/([^/]+)\/fhir\/bulkstatus/);
                        try {
                            args = JSON.parse(base64url.decode(args[1]));
                        } catch (ex) {
                            return done(ex);
                        }

                        if (args.start != EXPECTED) {
                            return done(`Expected "start" param to equal "${EXPECTED}" but found "${args.start}"`);
                        }

                        done();
                    },
                    ({ error }) => done(error)
                )
            });
        
            ["dur", "page", "err", "m"].forEach(param => {
                it (`passes the "${param}" sim parameter thru`, done => {
                    lib.requestPromise({
                        uri: meta.buildUrl({
                            [param]: `${param}-value`
                        }),
                        headers: {
                            Accept: "application/fhir+json",
                            Prefer: "respond-async"
                        }
                    })
                    .then(
                        res => {
                            let location = res.headers["content-location"] || "";
                            let args = location.match(/^http.*?\/([^/]+)\/fhir\/bulkstatus/);
                            if (!args || !args[1]) {
                                return done("Invalid content-location returned: " + location);
                            }
                            
                            try {
                                args = JSON.parse(base64url.decode(args[1]));
                            } catch (ex) {
                                return done(ex);
                            }
        
                            if (args[param] != `${param}-value`) {
                                return done(`Expected "${param}" param to equal "${param}-value" but found "${args[param]}"`);
                            }
                            done();
                        },
                        ({ error }) => done(error)
                    )
                });
            });
        
            it (`handles the the "file_generation_failed" simulated error`, done => {
                lib.requestPromise({
                    uri: meta.buildUrl({
                        "err": "file_generation_failed"
                    }),
                    json: true,
                    headers: {
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                })
                .then(
                    () => done("This request should not have succeeded!"),
                    ({ outcome }) => {
                        if (outcome.issue[0].diagnostics != "File generation failed") {
                            return done("Did not return the proper error");
                        }
                        done();
                    }
                );
            });

        });
    });
});

describe("Canceling", () => {
    it ("works", done => {
        let kickOffUrl = lib.buildPatientUrl({dur: 1});
        let statusUrl;
        
        lib.requestPromise({
            url: kickOffUrl,
            headers: {
                Accept: "application/fhir+json",
                Prefer: "respond-async"
            }
        })
        .then(res => {
            statusUrl = res.headers["content-location"];
            return statusUrl;
        })
        .then(() => lib.requestPromise({ url: statusUrl, method: "DELETE" }))
        .then(res => {
            expect.ok(res.body.issue[0].diagnostics == "The procedure was canceled")
            expect.ok(res.statusCode == 202)
        })
        .then(() => done())
        .catch(({ error }) => done(error))
    });

    it ("returns an error if trying to cancel twice", done => {
        let kickOffUrl = lib.buildPatientUrl({dur: 1});
        let statusUrl;
        
        lib.requestPromise({
            url: kickOffUrl,
            headers: {
                Accept: "application/fhir+json",
                Prefer: "respond-async"
            }
        })
        .then(res => {
            statusUrl = res.headers["content-location"];
            return statusUrl;
        })
        .then(() => lib.requestPromise({ url: statusUrl, method: "DELETE" }))
        .then(() => lib.requestPromise({ url: statusUrl, method: "DELETE" }))
        .then(res => {
            expect.ok(res.body.issue[0].diagnostics == "The procedure was already canceled by the client")
            expect.ok(res.statusCode == 410)
        })
        .catch(() => done())
    });

    it ("returns an error if trying to cancel unknown request", done => {
        lib.requestPromise({ url: lib.buildProgressUrl(), method: "DELETE" })
        .then(res => {
            expect.ok(res.body.issue[0].diagnostics == "Unknown procedure. Perhaps it is already completed and thus, it cannot be canceled")
            expect.ok(res.statusCode == 410)
        })
        .catch(() => done())
    });
});

describe("Progress Updates", () => {

    it ("rejects invalid auth token", () => rejects(
        lib.requestPromise({
            uri: lib.buildProgressUrl(),
            headers: {
                authorization: "Bearer badToken"
            }
        })
    ));

    it ("accepts valid auth token", () => {
        return lib.authorize()
        .then(tokenResponse => lib.requestPromise({
            uri: lib.buildProgressUrl({
                requestStart: moment().subtract(5, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                dur         : 2
            }),
            headers: {
                authorization: "Bearer " + tokenResponse.access_token
            }
        }))
        .catch(result => Promise.reject(result.outcome || result.error || result));
    });

    it ("requires an auth token if kicked off with auth", () => rejects(
        lib.requestPromise({
            uri: lib.buildProgressUrl({
                secure      : true,
                requestStart: moment().subtract(5, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                dur         : 2
            })
        })
    ));

    // implementation-specific
    it ("Requires 'requestStart' param", done => {
        request({ url: lib.buildProgressUrl() }, (error, res) => {
            if (error) {
                return done(error);
            }
            lib.expectErrorOutcome(res, {
                message: "The request start time parameter (requestStart) is missing in the encoded params",
                code   : 400
            }, done)
        });
    });

    it ("Validates the 'requestStart' param", done => {
        request({
            url: lib.buildProgressUrl({ requestStart: "xxxx" })
        }, (error, res) => {
            if (error) {
                return done(error);
            }
            lib.expectErrorOutcome(res, {
                message: "The request start time parameter (requestStart: xxxx) is invalid",
                code   : 400
            }, done)
        });     
    });

    it ("Rejects 'requestStart' in the future", done => {
        request({
            url: lib.buildProgressUrl({ requestStart: "2050-01-01" })
        }, (error, res) => {
            if (error) {
                return done(error);
            }
            lib.expectErrorOutcome(res, {
                message: "The request start time parameter (requestStart) must be a date in the past",
                code   : 400
            }, done);
        });
    });

    it ("Handles the 'dur' param", done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().subtract(1, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                dur         : 2
            })
        })
        .then(res => {
            if (res.statusCode != 202) {
                throw `Did not wait`;
            }
        })
        .then(() => {
            lib.requestPromise({
                url: lib.buildProgressUrl({
                    requestStart: moment().subtract(5, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                    dur         : 2
                }),
            })
            .then(res => {
                if (res.statusCode != 200) {
                    throw `Did not reply properly`;
                }
            })
        })
        .then(() => done(), ({ error }) => done(error));
    });

    it ("Replies with 202", done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().subtract(5, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                dur         : 10
            }),
            json: true
        })
        .then(res => {
            if (res.statusCode != 202) {
                throw `Expected 202 status code but got ${res.statusCode}`;
            }
        })
        .then(() => done(), ({ error }) => done(error));
    });

    it ("Replies with links after the wait time", done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().subtract(5, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                dur         : 2
            }),
            json: true
        })
        .then(res => {
            if (res.statusCode != 200) {
                throw `Did not reply properly`;
            }
            if (!res.body || !Array.isArray(res.body.output)) {
                throw `Did not reply with links array in body.output`;
            }
        })
        .then(() => done(), ({ error }) => done(error));
    });

    it ("Generates correct number of links", done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient",
                dur         : 0,
                page        : 25
            }),
            json: true
        })
        .then(res => {
            let n = res.body.output.length;
            if (n != 4) {
                throw `Expected 4 links but got ${n}`;
            }
        })
        .then(() => lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient",
                dur         : 0,
                page        : 22,
                m           : 10
            }),
            json: true
        }))
        .then(res => {
            let n = res.body.output.length;
            if (n != 46) {
                throw `Expected 40 links but got ${n}`;
            }
        })
        .then(() => done(), ({ error }) => done(error));
    });

    it ('Generates correct "count" property for each link', done => {
        // We have 100 patients. Using  a multiplier (`m`) of 10 and 22 records
        // per file, the result should contain 45 files of 22 resources and one
        // of 10 resources.
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient",
                dur         : 0,
                page        : 22,
                m           : 10
            }),
            json: true
        })
        .then(res => {
            // console.log(res.body);
            let n = res.body.output.length;
            if (n != 46) {
                throw `Expected 46 links but got ${n}`;
            }
            
            for (let i = 0; i < n; i++) {
                if (i < 45 && res.body.output[i].count != 22) {
                    throw `Expected count to equal 22 but got ${res.body.output[i].count}`;
                }
                else if (i == 45 && res.body.output[i].count != 10) {
                    throw `Expected count to equal 10 for the last page but got ${res.body.output[i].count}`;
                }
            }
        })
        .then(() => done(), done);
    })

    it ('Includes "error" property in the result', done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient",
                dur         : 0
            }),
            json: true
        })
        .then(res => {
            // console.log(res.body);
            assert.deepEqual(res.body.error, []);
        })
        .then(() => done(), done);
    })

    it ('Includes "error" entries for unknown resources', () => {
        return lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient,Xz,Yz",
                dur         : 0
            }),
            json: true
        })
        .catch(({ outcome }) => {
            assert.ok(outcome.issue[0].diagnostics === 'The requested resource type "Xz" is not available on this server');
        });
    })
});

describe("File Downloading", function() {
    
    this.timeout(15000);

    it ("rejects invalid auth token", () => rejects(
        lib.requestPromise({
            uri: lib.buildDownloadUrl("1.Patient.ndjson"),
            headers: {
                authorization: "Bearer badToken"
            }
        })
    ));
    
    it ("requires an auth token if kicked off with auth", () => rejects(
        lib.requestPromise({
            uri: lib.buildDownloadUrl("1.Patient.ndjson", {
                secure: true
            })
        })
    ));

    // Make sure that every single line contains valid JSON
    it ("Returns valid ndjson files", done => {
        // this.timeout(5000);
        let url = lib.buildDownloadUrl("1.Patient.ndjson");
        let errors = [];

        request({ url })
        .on("error", e => errors.push(String(e)))
        .on("end", () => {
            if (errors.length) {
                return done(errors.join(",\n"))
            }
            done();
        })
        .on("data", chunk => {
            try {
                JSON.parse(chunk);
            } catch (e) {
                errors.push(String(e));
            }
        });
    });
    
    it ("Handles the 'limit' parameter", done => {
        const limit = 12;
        let url = lib.buildDownloadUrl("1.Patient.ndjson", { limit });
        let errors = [], lines = 0;
        request({ url })
        .on("error", e => errors.push(String(e)))
        .on("end", () => {
            if (errors.length) {
                return done(errors.join(",\n"));
            }
            if (lines != limit) {
                return done(`Expected ${limit} lines but found ${lines}`);
            }
            done()
        })
        .on("data", () => lines++);
    });

    it ("Handles the 'offset' parameter", done => {

        // First download 2 patients with limit=2 and no offset
        lib.requestPromise({
            url: lib.buildDownloadUrl("1.Patient.ndjson", { limit: 2 })
        })
        .then(res => res.body.split("\n")[1])

        // Now add offset 1, fetch again and expect the first row to equal
        // the second one from the previous fetch
        .then(secondPatient => {
            return lib.requestPromise({
                url: lib.buildDownloadUrl("1.Patient.ndjson", {
                    limit: 2,
                    offset: 1
                })
            }).then(res2 => {
                let row1 = res2.body.split("\n")[0]
                let row2 = secondPatient

                const HEX  = "[a-fA-F0-9]"
                const RE_UID = new RegExp(
                    `\\br\\d-(${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12})\\b`,
                    "g"
                );

                row1 = row1.replace(RE_UID, "$1")
                row2 = row2.replace(RE_UID, "$1")

                if (row1 != row2) {
                    throw `Did not shift forward`
                }
            });
        })
        .then(() => done(), ({ error }) => done(error));
    });

    it ("The files have the correct number of lines", done => {
        lib.requestPromise({
            url: lib.buildDownloadUrl("1.Patient.ndjson", {
                limit : 6,
                offset: 1
            })
        }).then(res => {
            if (res.body.split("\n").length != 6) {
                throw `Did not return 6 rows`
            }
        })
        .then(() => done(), ({ error }) => done(error));
    });

    it ("can do limit and offset on Groups", done => {
        lib.requestPromise({
            url: lib.buildDownloadUrl("1.Group.ndjson", {
                systemLevel: true,
                limit : 6,
                offset: 1
            })
        }).then(res => {
            let len = res.body.split("\n").length;
            if (len != 6) {
                throw `Expected 6 rows but got ${len}`
            }
        })
        .then(() => done(), ({ error }) => done(error));
    });

    it ("can download Group files", done => {
        lib.requestPromise({
            url: lib.buildDownloadUrl("1.Group.ndjson", {
                systemLevel: true
            })
        }).then(res => {
            let len = res.body.split("\n").length;
            if (len != 8) {
                throw `Expected 8 rows but got ${len}`
            }
        })
        .then(() => done(), ({ error }) => done(error));
    });

    it ("Handles the '_since' parameter", done => {
        lib.requestPromise({
            url: lib.buildDownloadUrl("1.Patient.ndjson", {
                limit: 1,
                _since: "2000-01-01",
                extended: 1
            })
            // {"modified_date":"2000-01-01T00:00:00-05:00","type":"Patient","id":"dcae7046-ebb1-43d8-a615-bcc4628e834e"}
        })
        .then(res => {
            if (res.body.indexOf('"__modified_date":"2000-') == -1) {
                throw `Did not properly filter by modified_date #1: ${res.body}`
            }
        })
        .then(() => lib.requestPromise({
            url: lib.buildDownloadUrl("1.Patient.ndjson", {
                limit: 1,
                _since: "2008-07-25",
                extended: 1
            })
            // {"modified_date":"2008-07-26T09:35:17-04:00","type":"Patient","id":"e56a36d8-1412-427c-b96d-ad0a78114037"}
        }))
        .then(res => {
            if (res.body.indexOf('"__modified_date":"2011-05-') == -1) {
                throw `Did not properly filter by modified_date #2: ${res.body}`
            }
        })
        .then(() => done(), ({ error }) => done(error));
    });
    
    it ("Can simulate the 'file_missing_or_expired' error", done => {
        request({
            url: lib.buildDownloadUrl("1.Patient.ndjson", {
                limit: 1,
                err: "file_expired"
            })
        }, (error, res) => {
            if (error) {
                return done(error);
            }
            lib.expectErrorOutcome(res, {
                code   : 410
            }, done);
        })
    });

    it ("Does not download more data if the 'm' parameter is used", done => {
        downloadPatients({
            limit : 100,
            offset: 0,
            m     : 3
        })
        .then(patients => {
            if (patients.length != 100) {
                throw `0. Expected 100 patients but found ${patients.length}`
            }
        })
        .then(() => done(), ({ error }) => done(error))
    });

    it ("Does not prefix IDs on the first page", done => {
        downloadPatients({
            limit : 100,
            offset: 0,
            m     : 2
        })
        .then(patients => {
            if (patients.some(p => /^p\d+\-/.test(p.id))) {
                throw `Patient IDs are prefixed on the first page but they shouldn't`
            }
        })
        .then(() => done(), ({ error }) => done(error))
    });

    it ("Can go to virtual second page if multiplier allows it", done => {
        downloadPatients({
            limit : 100,
            offset: 100,
            m     : 2
        })
        .then(patients => {
            if (patients.length != 100) {
                throw `1. Expected 100 patients but found ${patients.length}`
            }
            if (patients.some(p => p.id.indexOf("p2-") !== 0)) {
                throw `Patient IDs are not prefixed with "p2-" on the second page but they should`
            }
            done()
        })
        .catch(({ error }) => done(error))
    });

    it ("Can go to virtual third page if multiplier allows it", done => {
        downloadPatients({
            limit : 100,
            offset: 200,
            m     : 3
        })
        .then(patients => {
            if (patients.length != 100) {
                throw `1. Expected 100 patients but found ${patients.length}`
            }
            if (patients.some(p => p.id.indexOf("p3-") !== 0)) {
                throw `Patient IDs are not prefixed with "p3-" on the third page but they should`
            }
        })
        .then(() => done(), ({ error }) => done(error))
    });

    it ("Does not fetch data beyond the limits", done => {
        downloadPatients({
            limit : 100,
            offset: 300,
            m     : 3
        })
        .then(patients => {
            if (patients.length != 0) {
                throw `Expected 0 patients but found ${patients.length}`
            }
        })
        .then(() => done(), ({ error }) => done(error));
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

    it ("Handles the virtual files properly", () => {

        /**
         * @param {string} resourceType The name of the resource we are testing
         */
        async function test(resourceType) {

            const multiplier = 3;

            const resourceCount = (await lib.requestPromise({
                url: lib.buildBulkUrl(["$get-resource-counts"]),
                json: true
            })).body.parameter.find(p => p.name === resourceType).valueInteger;

            // console.log(`${resourceType}: ${resourceCount}`);

            const totalLines = resourceCount * multiplier;

            // Make sure we don't truncate the file
            const limit = totalLines + 10;

            // The number of resources we expect to receive
            const expectedLines = totalLines;

            // Build the file download URL
            const url = lib.buildDownloadUrl(`1.${resourceType}.ndjson`, {
                m: multiplier,
                limit,
                offset: 0
            });

            return lib.requestPromise({ url }).then(res => {
                let lines = res.body.trim().split("\n").map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l).id);

                // Check the expected rows length
                if (lines.length != expectedLines) {
                    throw new Error(
                        `${resourceType} - Expected ${expectedLines} lines but found ${lines.length}`
                    );
                }
                
                // Check if the IDs are properly generated
                for (let i = resourceCount; i < resourceCount * 2; i++) {
                    let expectedId = "o1-" + lines[i - resourceCount];
                    if (lines[i] !== expectedId) {
                        throw new Error(
                            `Expecting the ID of line ${i} to equal "${expectedId}"`
                        );
                    }
                }
                for (let i = resourceCount * 2; i < resourceCount * 3; i++) {
                    let expectedId = "o2-" + lines[i - resourceCount * 2];
                    if (lines[i] !== expectedId) {
                        throw new Error(
                            `Expecting the ID of line ${i} to equal "${expectedId}"`
                        );
                    }
                }
            });
        }

        return Promise.all([
            test("AllergyIntolerance"),
            test("Patient"),
            test("Device"),
            test("DocumentReference"),
            test("Binary")
        ]);

    });
});

describe("References", () => {

});

describe("All Together", () => {

    it ("Requires auth if kicked off with auth", () => {
        
        let accessToken, statusUrl, fileUrl;

        return lib.authorize()
        
        .then(tokenResponse => {
            accessToken = tokenResponse.access_token;
            return lib.requestPromise({
                uri: lib.buildPatientUrl({ dur: 0 }),
                qs : { _type: "Patient" },
                headers: {
                    Accept: "application/fhir+json",
                    Prefer: "respond-async",
                    Authorization: "Bearer " + accessToken,
                }
            })
        })

        .then(res => res.headers["content-location"])

        .then(_statusUrl => {
            statusUrl = _statusUrl;
            return lib.requestPromise({ uri: statusUrl })
        })
        
        .then(() => {
            throw "Requesting status without auth should have failed"
        }, res => res)

        .then(() => lib.requestPromise({
            uri: statusUrl,
            json: true,
            headers: {
                Authorization: "Bearer " + accessToken
            }
        }))

        .then(res => {
            fileUrl = res.body.output[0].url
        })

        .then(() => lib.requestPromise({ uri: fileUrl }))

        .then(() => {
            throw "Requesting status without auth should have failed"
        }, res => res)

        .then(() => lib.requestPromise({
            uri: fileUrl,
            json: true,
            headers: {
                Accept: "application/fhir+ndjson",
                Authorization: "Bearer " + accessToken
            }
        }))

        .catch(result => Promise.reject(result.outcome || result.error || result));
    });

    it ("Should download 2 valid Observation ndjson files", function(done) {

        this.timeout(50000);

        const TYPE = "AllergyIntolerance";

        lib.requestPromise({
            uri: lib.buildPatientUrl({ dur: 0, page: 20, m: 1 }),
            qs : {
                _type: TYPE
            },
            headers: {
                Accept: "application/fhir+json",
                Prefer: "respond-async"
            }
        })

        // Get the progress endpoint
        .then(res => res.headers["content-location"])

        // Query the progress endpoint
        .then(statusUrl => lib.requestPromise({ uri: statusUrl, json: true }))

        // get the download links
        .then(res => res.body.output || [])

        // Check the links count
        .then(links => {
            if (links.length != 2) {
                throw "Wrong number of links returned";
            }
            return links;
        })

        // convert links to URLs
        .then(links => links.map(l => l.url))

        // validate file names
        .then(links => {
            let re = /\/([^/]+)$/
            links.forEach((l, i) => {
                let m = l.match(re);
                if (!m || !m[1]) {
                    throw "Invalid file name";
                }
                let tokens = m[1].split(".");
                if (tokens.length != 3) {
                    throw `Invalid file name "${m[1]}". Should have 3 parts`;
                }
                if (tokens[0] != i + 1) {
                    throw `Invalid file name "${m[1]}". Should start with ${i + 1}`;
                }

                if (tokens[1] != TYPE) {
                    throw `Invalid file name "${m[1]}". Should start with ${i + 1}.${TYPE}`;
                }

                if (tokens[2] != "ndjson") {
                    throw `Invalid file name "${m[1]}". Should end with ".ndjson"`;
                }
            });
            return links;
        })

        // Check if multiple files have the same args
        .then(links => {
            let args1 = links[0].match(/\/bulkfiles2?\/([^/]+)/)[1];
            let args2 = links[1].match(/\/bulkfiles2?\/([^/]+)/)[1];
            if (args1 == args2) {
                throw "Same args passed to two sequential files";
            }
            return links;
        })

        // .then(links => {
        //     links.forEach(l => console.log(l));
        //     return links;
        // })

        // Do download the files
        .then(links => Promise.all(links.map(l => lib.requestPromise({ url: l }))))

        // Convert to JSON lines
        .then(files => files.map(f => f.body.trim().split("\n")))

        // Count lines
        .then(files => {
            let l1 = files[0].length;
            let l2 = files[1].length;
            if (l1 != 20) {
                throw `The first ${TYPE} file should have 20 lines but found ${l1}`;
            }
            if (l2 != 10) {
                throw `The second ${TYPE} file should have 10 lines but found  ${l2}`;
            }
            return files;
        })

        // look for repeated IDs
        .then(files => {
            let ids = {};
            files.forEach(file => {
                file.forEach(row => {
                    let r = JSON.parse(row)
                    if (ids[r.id]) {
                        throw `Duplicate id ${r.id} for ${r.resourceType}`
                    }
                    ids[r.id] = 1
                })
            });
            return files;
        })

        // exit
        .then(() => done(), ({ error }) => done(error));
    });
});

describe("Groups", () => {
    it ("Blue Cross Blue Shield should have 27 patients in the test DB", function(done) {
        this.timeout(10000);

        const BlueCCrossBlueShieldId = 11534;
        lib.requestPromise({
            uri: lib.buildGroupUrl(BlueCCrossBlueShieldId, { dur: 0 }),
            qs : {
                _type: "Patient"
            },
            headers: {
                Accept: "application/fhir+json",
                Prefer: "respond-async"
            }
        })

        // Get the progress endpoint
        .then(res => res.headers["content-location"])

        // Query the progress endpoint
        .then(statusUrl => lib.requestPromise({ uri: statusUrl, json: true }))

        // get the download links
        .then(res => res.body.output || [])

        // Check the links count
        .then(links => {
            if (links.length != 1) {
                throw "Wrong number of links returned";
            }
            if (!links[0].url.endsWith("1.Patient.ndjson")) {
                throw "Wrong link returned";
            }
            return links;
        })

        // convert links to URL
        .then(links => links[0].url)

        // Do download the files
        .then(link => lib.requestPromise({ url: link }))

        // Convert to JSON lines
        .then(file => file.body.trim().split("\n"))

        // Count lines
        .then(lines => {
            let len = lines.length;
            if (len != 27) {
                throw `The file should have 27 lines but found ${len}`;
            }
            return lines;
        })

        // look for repeated IDs
        .then(lines => {
            let ids = {};
            lines.forEach(row => {
                let r = JSON.parse(row)
                if (ids[r.id]) {
                    throw `Duplicate id ${r.id} for ${r.type}`
                }
                ids[r.id] = 1
            });
            return lines;
        })

        // exit
        .then(() => done(), ({ error }) => done(error));
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

    const privateKey  = jwkToPem(jwks.keys[1], { private: true });
    const tokenUrl    = lib.buildUrl(["auth", "token"]);
    const registerUrl = lib.buildUrl(["auth", "register"]);

    function assertError(requestOptions, expected, code, message="") {
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
                            // ex.message
                            " The error response should equal:\n" +
                            JSON.stringify(expected, null, 2) +
                            "\n but was:\n" +
                            JSON.stringify(result.response.body, null, 2)
                        ));
                    }
                    // if (result.response.body !== expected) {
                    //     message += " The error response should equal\n" +
                    //         JSON.stringify(expected, null, 2) +
                    //         "\n but was:\n" +
                    //         JSON.stringify(result.response.body, null, 2);
                    //     return Promise.reject(new Error(message));
                    // }
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
            it("returns invalid_grant with missing grant_type parameter", () => {
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
                assert.equal(result.response.body.error, "invalid_request");
                assert.ok(
                    result.response.body.error_description.indexOf("Invalid registration token: ") === 0
                );
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
                assert.equal(result.response.body.error, "invalid_request");
                assert.ok(
                    result.response.body.error_description.indexOf("Invalid registration token: ") === 0
                );
            });
        });

        it("returns 400 invalid_request if the token does not contain valid client_id (sub) token", () => {
            return assertError({
                method: "POST",
                json  : true,
                url   : tokenUrl,
                form  : {
                    grant_type           : "client_credentials",
                    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                    client_assertion     : jwt.sign({ a: 1 }, privateKey, {
                        algorithm: jwks.keys[1].alg,
                        keyid    : jwks.keys[1].kid,
                        header: {
                            kty: jwks.keys[1].kty
                        }
                    })
                }
            }, null, 400).catch(result => {
                assert.equal(result.response.body.error, "invalid_request");
                // console.log(result.response.body.error_description)
                assert.ok(
                    result.response.body.error_description.indexOf("Invalid client details token: ") === 0,
                    "The error description must begin with 'Invalid client details token: '"
                );
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.*",
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.*",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, null, 400).catch(result => {
                    assert.equal(result.response.body.error, "invalid_grant");
                    // console.log(result.response.body.error_description)
                    assert.ok(
                        result.response.body.error_description.indexOf("Invalid token 'aud' value. Must be ") === 0,
                        `The error description must begin with 'Invalid token 'aud' value. Must be `
                    );
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.*",
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.*",
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
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
                    error_description: 'Invalid scope: "whatever"'
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.*",
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
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
                        scope                : "system/*.*",
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
            function hostJWKS(jwks) {
                return new Promise(resolve => {
                    const app = express();
                    app.get("/jwks", (req, res) => res.json({}));
                    const server = app.listen(0, () => resolve(server));
                })
                .then(server => {
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
                                scope                : "system/*.*",
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.*",
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
                    keyid    : jwks.keys[1].kid
                });

                return assertError({
                    method: "POST",
                    json  : true,
                    url   : tokenUrl,
                    form  : {
                        scope                : "system/*.*",
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
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
                        scope                : "system/*.*",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: `No public keys found in the JWKS with "kid" equal to "${
                        jwks.keys[1].kid
                    }" and "kty" equal to "${jwks.keys[1].kty}"`
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
            }
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
                    exp: Date.now()/1000 + 300, // 5 min
                    jti: crypto.randomBytes(32).toString("hex")
                };
            }).then(token => {
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
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
                        scope                : "system/*.*",
                        grant_type           : "client_credentials",
                        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                        client_assertion     : signed
                    }
                }, {
                    error: "invalid_grant",
                    error_description: `Unable to verify the token with any of the public keys found in the JWKS`
                }, 400);
            })
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
                let signed = jwt.sign(token, privateKey, {
                    algorithm: jwks.keys[1].alg,
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
                        scope                : "system/*.*",
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

