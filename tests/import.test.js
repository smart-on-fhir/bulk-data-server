
const DownloadTask = require("../import/DownloadTask");
const assert       = require("assert");
const { finished } = require("stream");
const config       = require("../config");
const NDJSONStream = require("../import/NDJSONStream");
const MockReadable = require("./mocks/ReadStream");
const mockServer   = require("./mocks/mockServer");
const lib          = require("./lib");
const { server }   = require("../index");

const MOCK_BASE_URL = "https://127.0.0.1:8443/";
// const API_BASE = MOCK_BASE_URL + "byron/fhir";


before(next => {
    mockServer.httpsServer.listen("8443", () => {
        if (!server.listening)
            server.listen(config.port);
        next()
    });
});

after(next => {
    mockServer.httpsServer.close();
    // if (server) {
    server.close();
        // server = null;
    // }
    next();
});

function fakeResponse(cfg) {
    // @ts-ignore
    mockServer.app.mock(cfg);
}


// Begin tests =================================================================

describe("NDJSONStream", () => {

    it ("handles empty input", (next) => {
        const input = new MockReadable('', { highWaterMark: 3 });
        const ndjsonStream = new NDJSONStream();

        const result = [];
        
        ndjsonStream.on("data", object => result.push(object));
        
        finished(ndjsonStream, error => {
            assert.ok(!error);
            assert.deepEqual(result, []);
            next();
        });

        input.pipe(ndjsonStream);
    });

    it ("handles ndjson files that end with EOL", (next) => {
        const input = new MockReadable('{"a":1}\n{"a":2}\n', { highWaterMark: 3 });
        const ndjsonStream = new NDJSONStream();

        const result = [];
        
        ndjsonStream.on("data", object => result.push(object));

        finished(ndjsonStream, error => {
            assert.ok(!error);
            assert.deepEqual(result, [{ "a" : 1 }, { "a": 2 }]);
            next();
        });

        input.pipe(ndjsonStream);
    });

    it ("handles ndjson files that don't end with EOL", (next) => {
        const input = new MockReadable('{"a":1}\n{"a":2}', { highWaterMark: 3 });
        const ndjsonStream = new NDJSONStream();

        const result = [];
        
        ndjsonStream.on("data", object => result.push(object));

        finished(ndjsonStream, error => {
            assert.ok(!error);
            assert.deepEqual(result, [{ "a" : 1 }, { "a": 2 }]);
            next();
        });

        input.pipe(ndjsonStream);
    });

    it ("handles ndjson files that contain empty lines", (next) => {
        const input = new MockReadable('{"a":1}\n\n\n{"a":2}', { highWaterMark: 3 });
        const ndjsonStream = new NDJSONStream();

        const result = [];
        
        ndjsonStream.on("data", object => result.push(object));

        finished(ndjsonStream, error => {
            assert.ok(!error);
            assert.deepEqual(result, [{ "a" : 1 }, { "a": 2 }]);
            next();
        });

        input.pipe(ndjsonStream);
    });

    it ("handles json errors in ndjson files", (next) => {
        const input = new MockReadable('{"a:1}\n{"a":2}', { highWaterMark: 3 });
        const ndjsonStream = new NDJSONStream();

        finished(ndjsonStream, error => {
            assert.ok(error && error instanceof SyntaxError);
            assert.equal(error.message, "Error parsing NDJSON on line 1: Unexpected end of JSON input");
            next();
        });

        input.pipe(ndjsonStream);
    });

    it ("handles json errors on last line", (next) => {
        const input = new MockReadable('{"a":1}\n{"a":2', { highWaterMark: 3 });
        const ndjsonStream = new NDJSONStream();

        finished(ndjsonStream, error => {
            assert.ok(error && error instanceof SyntaxError);
            assert.equal(error.message, "Error parsing NDJSON on line 2: Unexpected end of JSON input");
            next();
        });

        input.pipe(ndjsonStream);
    });

    it ("enforces a line limit for ndjson files", (next) => {
        const orig = config.ndjsonMaxLineLength;
        config.ndjsonMaxLineLength = 2;
        
        const input = new MockReadable('{"a":1}\n{"a":2}', { highWaterMark: 3 });
        const ndjsonStream = new NDJSONStream();

        finished(ndjsonStream, error => {
            config.ndjsonMaxLineLength = orig;
            assert.ok(error && error instanceof Error);
            assert.equal(error.message.indexOf("Buffer overflow"), 0);
            next();
        });

        input.pipe(ndjsonStream);
    });
});

describe("DownloadTask", () => {

    it ("rejects http urls", next => {
        const task = new DownloadTask({
            url: "http://127.0.0.1/missing"
        });

        assert.rejects(() => {
            return task.init();
        }, /Protocol "http:" not supported. Expected "https:"/)
        .then(() => next()).catch(next);
    });

    it ("handles connection errors", async () => {
        const task = new DownloadTask({
            url: "https://127.0.0.1/missing" // <- does not exist!
        });
        try {
            await task.init();
            throw new Error("Did not throw");
        } catch (ex) {
            assert.match(ex.message, /ECONNREFUSED/);
        }
    });

    it ("handles server errors", async () => {
        fakeResponse({ status: 500 });
        try {
            const task = new DownloadTask({ url: MOCK_BASE_URL });
            await task.init();
            throw new Error("Did not throw");
        } catch (ex) {
            assert.match(ex.message, /^500/);
        }
    });

    it ("reads the content-length header to set the total property", async () => {
        fakeResponse({ status: 200, body: "12345" });
        const task = new DownloadTask({ url: MOCK_BASE_URL });
        await task.init();
        assert.equal(task.total, 5);
    });

    it ("handles invalid file types")

    it ("start() returns a stream even if the request has failed")
    it ("handles ndjson parsing errors")
    it ("emits events")
    it ("computes progress and remaining time")
});

describe("DownloadTaskCollection", () => {
    it ("computes progress and remaining time");
    it ("builds correct summary after all tasks are finished");
});

describe("TaskManager", () => {
    it ("get");
    it ("has");
    it ("add");
    it ("remove");
    it ("auto-remove");
});

describe("Import kick-off endpoint", () => {

    it ("Requires Content-Type: application/json", async () => {

        // Send all required headers except "Content-Type"
        return lib.requestPromise({
            url: lib.buildUrl(["/byron/fhir/$import"]),
            method: "POST",
            headers: {
                "Accept": "application/fhir+json",
                "Prefer": "respond-async"
            }
        })
        .then(() => {
            throw new Error("Did not fail as expected");
        })
        .catch(error => {
            const outcome = JSON.parse(error.response.body);
            assert.equal(outcome.issue[0].diagnostics, "The Content-Type header must be application/json");
        });
    });

    it ("Requires Accept: application/fhir+json", async () => {

        // Send all required headers except "Accept"
        return lib.requestPromise({
            url: lib.buildUrl(["/byron/fhir/$import"]),
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Prefer": "respond-async"
            }
        })
        .then(() => {
            throw new Error("Did not fail as expected");
        })
        .catch(error => {
            const outcome = JSON.parse(error.response.body);
            assert.equal(outcome.issue[0].diagnostics, "The Accept header must be application/fhir+json");
        });
    });

    it ("Requires Prefer: respond-async", async () => {

        // Send all required headers except "Prefer"
        return lib.requestPromise({
            url: lib.buildUrl(["/byron/fhir/$import"]),
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/fhir+json"
            }
        })
        .then(() => {
            throw new Error("Did not fail as expected");
        })
        .catch(error => {
            const outcome = JSON.parse(error.response.body);
            assert.equal(outcome.issue[0].diagnostics, "The Prefer header must be respond-async");
        });
    });
});

describe("Import status endpoint", () => {});

describe("Import cancellation endpoint", () => {});
