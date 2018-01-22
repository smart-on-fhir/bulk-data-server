const request   = require("request");
const base64url = require("base64-url");
const moment    = require("moment");
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

function downloadPatients(options) {
    let url = lib.buildDownloadUrl("1.Patient.ndjson", options);
    return lib.requestPromise({ url })
        .then(res => res.body.split("\n").filter(r => !!r).map(row => {
            // console.log("row: '" + row + "'");
            try {
                return JSON.parse(row)
            } catch (ex) {
                console.log("rows: '" + res.body + "'");
                throw ex;
            }
        }));
}

// Begin tests =================================================================

[
    {
        description: "/fhir/Patient/$everything",
        buildUrl   : lib.buildPatientUrl
    },
    {
        description: "/:sim/fhir/Patient/$everything",
        buildUrl   : params => lib.buildPatientUrl(Object.assign({}, params || {}))
    },
    {
        description: "/fhir/Group/:groupId/$everything",
        buildUrl   : params => lib.buildGroupUrl(1, params)
    },
    {
        description: "/:sim/fhir/Group/:groupId/$everything",
        buildUrl   : params => lib.buildGroupUrl(1, Object.assign({}, params || {}))
    }
].forEach(meta => {
    describe(meta.description, () => {
        
        it ("rejects invalid auth token", done => {
            lib.requestPromise({
                uri: meta.buildUrl(),
                headers: {
                    authorization: "Bearer badToken"
                }
            })
            .then(
                res   => done("This request should not have succeeded!"),
                error => done()
            )
        });

        it ("accepts valid auth token", done => {
            lib.authorize()
            .then(tokenResponse => lib.requestPromise({
                uri: meta.buildUrl(),
                headers: {
                    authorization: "Bearer " + tokenResponse.access_token,
                    Accept: "application/fhir+ndjson",
                    Prefer: "respond-async"
                }
            }))
            .then(() => done(), done)
        });

        it ("requires 'Accept: application/fhir+ndjson' header", done => {
            request({ uri: meta.buildUrl() }, (error, res) => {
                if (error) {
                    return done(error);
                }
                lib.expectErrorOutcome(res, {
                    message: "The Accept header must be application/fhir+ndjson",
                    code   : 400
                }, done)
            });
        });

        it ("requires 'Prefer: respond-async' header", done => {
            request({
                uri: meta.buildUrl(),
                headers: {
                    Accept: "application/fhir+ndjson"
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

        it ("returns proper content-location header", done => {
            lib.requestPromise({
                uri: meta.buildUrl(),
                headers: {
                    Accept: "application/fhir+ndjson",
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
                done
            )
        });

        it (`handles the "_type" and "start" query parameter`, done => {
            const TYPE = "Observation", START = "2010-01-01", EXPECTED = "2010-01-01 00:00:00";
            lib.requestPromise({
                uri: meta.buildUrl({ dur: 1 }),
                qs : {
                    _type: TYPE,
                    start: START
                },
                headers: {
                    Accept: "application/fhir+ndjson",
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
                done
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
                    start: IN
                },
                headers: {
                    Accept: "application/fhir+ndjson",
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
                done
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
                    start: IN
                },
                headers: {
                    Accept: "application/fhir+ndjson",
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
                done
            )
        });
    
        ["dur", "page", "err", "m"].forEach(param => {
            it (`passes the "${param}" sim parameter thru`, done => {
                lib.requestPromise({
                    uri: meta.buildUrl({
                        [param]: `${param}-value`
                    }),
                    headers: {
                        Accept: "application/fhir+ndjson",
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
                    done
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
                    Accept: "application/fhir+ndjson",
                    Prefer: "respond-async"
                }
            })
            .then(
                () => done("This request should not have succeeded!"),
                error => {
                    if (error.issue[0].diagnostics != "File generation failed") {
                        return done("Did not return the proper error");
                    }
                    done();
                }
            );
        });

    });
});

describe("Progress Updates", () => {

    it ("rejects invalid auth token", done => {
        lib.requestPromise({
            uri: lib.buildProgressUrl(),
            headers: {
                authorization: "Bearer badToken"
            }
        })
        .then(
            res   => done("This request should not have succeeded!"),
            error => done()
        )
    });

    it ("accepts valid auth token", done => {
        lib.authorize()
        .then(tokenResponse => request({
            uri: lib.buildProgressUrl({
                requestStart: moment().subtract(5, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                dur         : 2
            }),
            headers: {
                authorization: "Bearer " + tokenResponse.access_token
            }
        }))
        .then(() => done(), done)
    });

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
        .then(() => done(), done);
    });

    it ("Replies with links after the wait time", done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().subtract(5, "seconds").format("YYYY-MM-DD HH:mm:ss"),
                dur         : 2
            })
        })
        .then(res => {
            if (res.statusCode != 200) {
                throw `Did not reply properly`;
            }
            if (!res.headers.link) {
                throw `Did not reply with 'Link' header`;
            }
        })
        .then(() => done(), done);
    });

    it ("Generates correct number of links", done => {
        lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient",
                dur         : 0,
                page        : 25
            })
        })
        .then(res => {
            let n = res.headers.link.split(",").length;
            if (n != 4) {
                throw `Expected 4 links but got ${n}`;
            }
        })
        .then(() => lib.requestPromise({
            url: lib.buildProgressUrl({
                requestStart: moment().format("YYYY-MM-DD HH:mm:ss"),
                type        : "Patient",
                dur         : 0,
                page        : 25,
                m           : 10
            })
        }))
        .then(res => {
            let n = res.headers.link.split(",").length;
            if (n != 40) {
                throw `Expected 4 links but got ${n}`;
            }
        })
        .then(() => done(), done);
    });
});

describe("File Downloading", () => {

    it ("rejects invalid auth token", done => {
        lib.requestPromise({
            uri: lib.buildDownloadUrl("1.Patient.ndjson"),
            headers: {
                authorization: "Bearer badToken"
            }
        })
        .then(
            res   => done("This request should not have succeeded!"),
            error => done()
        )
    });

    // Make sure that every single line contains valid JSON
    it ("Returns valid ndjson files", done => {
        let url = lib.buildDownloadUrl("1.Patient.ndjson");
        let errors = [];

        request({ url })
        .on("error", e => e.push(String(e)))
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
                e.push(String(e));
            }
        });
    });
    
    it ("Handles the 'limit' parameter", done => {
        const limit = 12;
        let url = lib.buildDownloadUrl("1.Patient.ndjson", { limit });
        let errors = [], lines = 0;

        request({ url })
        .on("error", e => e.push(String(e)))
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
                if (res2.body.split("\n")[0] != secondPatient) {
                    throw `Did not shift forward`
                }
            });
        })
        .then(() => done(), done);
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
        .then(() => done(), done);
    });

    it ("Handles the 'start' parameter", done => {
        lib.requestPromise({
            url: lib.buildDownloadUrl("1.Patient.ndjson", {
                limit: 1,
                start: "2000-01-01",
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
                start: "2008-07-25",
                extended: 1
            })
            // {"modified_date":"2008-07-26T09:35:17-04:00","type":"Patient","id":"e56a36d8-1412-427c-b96d-ad0a78114037"}
        }))
        .then(res => {
            if (res.body.indexOf('"__modified_date":"2011-05-') == -1) {
                throw `Did not properly filter by modified_date #2: ${res.body}`
            }
        })
        .then(() => done(), done);
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
        .then(() => done(), done)
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
        .then(() => done(), done)
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
        .then(() => done(), done)
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
        .then(() => done(), done)
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
        .then(() => done(), done);
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
        .then(() => done(), err => {
            console.error(err);
            done(err)
        });
    });
});

describe("All Together", () => {
    it ("Should download 2 valid Observation ndjson files", function(done) {

        this.timeout(20000);

        const TYPE = "Observation";

        lib.requestPromise({
            uri: lib.buildPatientUrl({ dur: 0, page: 5000, m: 1 }),
            qs : {
                _type: TYPE
            },
            headers: {
                Accept: "application/fhir+ndjson",
                Prefer: "respond-async"
            }
        })

        // Get the progress endpoint
        .then(res => res.headers["content-location"])

        // Query the progress endpoint
        .then(statusUrl => lib.requestPromise({ uri: statusUrl }))

        // get the download links
        .then(res => res.headers.link.split(","))

        // Check the links count
        .then(links => {
            if (links.length != 2) {
                throw "Wrong number of links returned";
            }
            return links;
        })

        // convert links to URLs
        .then(links => links.map(l => l.replace(/^</, "").replace(/>$/, "")))

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
            let args1 = links[0].match(/\/bulkfiles\/([^/]+)/)[1];
            let args2 = links[1].match(/\/bulkfiles\/([^/]+)/)[1];
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
            if (l1 != 5000) {
                throw `The first ${TYPE} file should have 5000 lines but found ${l1}`;
            }
            if (l2 != 157) {
                throw `The second ${TYPE} file should have 157 lines but found  ${l2}`;
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
                        throw `Duplicate id ${r.id} for ${r.type}`
                        // console.error(`Duplicate id ${r.id} for ${r.type}`.red);
                        // return;
                    }
                    ids[r.id] = 1
                })
            });
            return files;
        })

        // exit
        .then(() => done(), done);
    });
});

describe("Groups", () => {
    it ("Blue Cross Blue Shield should have 27 patients in the test DB", function(done) {
        this.timeout(10000);

        // console.log(lib.buildGroupUrl(1, { dur: 0 }))
        lib.requestPromise({
            uri: lib.buildGroupUrl(1, { dur: 0 }),
            qs : {
                _type: "Patient"
            },
            headers: {
                Accept: "application/fhir+ndjson",
                Prefer: "respond-async"
            }
        })

        // Get the progress endpoint
        .then(res => res.headers["content-location"])

        // Query the progress endpoint
        .then(statusUrl => lib.requestPromise({ uri: statusUrl }))

        // get the download links
        .then(res => res.headers.link.split(","))

        // Check the links count
        .then(links => {
            if (links.length != 1) {
                throw "Wrong number of links returned";
            }
            if (!links[0].endsWith("1.Patient.ndjson>")) {
                throw "Wrong link returned";
            }
            return links;
        })

        // convert links to URL
        .then(links => links[0].replace(/^</, "").replace(/>$/, ""))

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
        .then(() => done(), done);
    });
});

