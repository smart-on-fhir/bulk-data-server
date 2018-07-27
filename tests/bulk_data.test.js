const request   = require("request");
const base64url = require("base64-url");
const moment    = require("moment");
const assert    = require("assert"); //.strict;
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
        .then(res => res.body.split("\n"))
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

            it ("accepts valid auth token", done => {
                lib.authorize()
                .then(tokenResponse => lib.requestPromise({
                    uri: meta.buildUrl(),
                    headers: {
                        authorization: "Bearer " + tokenResponse.access_token,
                        Accept: "application/fhir+json",
                        Prefer: "respond-async"
                    }
                }))
                .then(() => done(), ({ error }) => done(error))
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

    it ("accepts valid auth token", done => {
        lib.authorize()
        .then(tokenResponse => lib.requestPromise({
            uri: lib.buildProgressUrl({
                requestStart: moment().subtract(5, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                dur         : 2
            }),
            headers: {
                authorization: "Bearer " + tokenResponse.access_token
            }
        }))
        .then(() => done(), ({ error }) => done(error))
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

    it ('Includes "errors" property in the result', done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient",
                dur         : 0
            }),
            json: true
        })
        .then(res => assert.deepEqual(res.body.errors, []))
        .then(() => done(), done);
    })

    it ('Includes "errors" entries for unknown resources', done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient,Xz,Yz",
                dur         : 0
            }),
            json: true
        })
        .then(res => {
            // console.log(res.body.errors)
            assert.ok(res.body.errors.length === 2);
            assert.ok(res.body.errors[0].type === "OperationOutcome");
            assert.ok(res.body.errors[0].url.split("/").pop() === "Xz.error.ndjson");
            assert.ok(res.body.errors[1].type === "OperationOutcome");
            assert.ok(res.body.errors[1].url.split("/").pop() === "Yz.error.ndjson");
        })
        .then(() => done(), done);
    })
});

describe("File Downloading", function() {

    this.timeout(5000);

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
        })
        .then(() => done(), ({ error }) => done(error))
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

    it ("Handles the 'm' parameter for multiplication", done => {
        downloadPatients({
            limit : 10,
            offset: 15
        })
        .then(patients => {
            let target = [
                'p2', // 16
                'p2', // 17
                'p2', // 18
                'p2', // 19
                'p2', // 20
                'p3', // 21
                'p3', // 22
                'p3', // 23
                'p3', // 24
                'p3', // 25
            ].join(",");
            let src = patients.map(p => p.id.substr(0, 2)).join(",")
            if (src != target) {
                throw `Expected ID prefixes to equal ${target} but found ${src}`
            }
        })
        .then(() => done(), ({ error }) => {
            console.error(error);
            done(error)
        });
    });
});

describe("All Together", () => {

    it ("Requires auth if kicked off with auth", function(done) {
        
        let accessToken, statusUrl, fileUrl;

        lib.authorize()
        
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

        .then(() => done(), ({ error }) => done(error));
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

