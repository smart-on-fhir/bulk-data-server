
const DownloadTask = require("../import/DownloadTask");
const assert       = require("assert");
const { finished } = require("stream");
const config       = require("../config");
const NDJSONStream = require("../import/NDJSONStream");
const MockReadable = require("./mocks/ReadStream");
const mockServer   = require("./mocks/mockServer");
const lib          = require("./lib");
const { server }   = require("../index");
const Task         = require("../import/Task");
const TaskManager  = require("../import/TaskManager");

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

function kickOff(payload, headers = {})
{
    return lib.requestPromise({
        url: lib.buildUrl(["/byron/fhir/$import"]),
        method: "POST",
        body: JSON.stringify({
            inputFormat: "application/fhir+ndjson",
            inputSource: "https://test",
            storageDetail: {
                type: "https",
                ...payload.storageDetail
            },
            input: [
                ...payload.input || []
            ],
            ...payload
        }),
        headers: {
            "Accept": "application/fhir+json",
            "Prefer": "respond-async",
            "Content-Type": "application/json",
            ...headers
        }
    })
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

    it ("Requires Content-Type: application/json", () => {
        return kickOff({}, { "Content-Type": undefined })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "The Content-Type header must be application/json");
            });
    });

    it ("Requires Accept: application/fhir+json", () => {
        return kickOff({}, { Accept: undefined })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "The Accept header must be application/fhir+json");
            });
    });

    it ("Requires Prefer: respond-async", () => {
        return kickOff({}, { Prefer: undefined })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "The Prefer header must be respond-async");
            });
    });

    it ("Validates inputFormat", async () => {
        // inputFormat is required
        await kickOff({ inputFormat: undefined })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'The "inputFormat" JSON parameter is required');
            });

        // inputFormat must be a string
        await kickOff({ inputFormat: 777 })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'The "inputFormat" JSON parameter must be a string');
            });

        // inputFormat must be "application/fhir+ndjson"
        await kickOff({ inputFormat: "whatever" })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.match(outcome.issue[0].diagnostics, /^The server did not recognize the provided inputFormat whatever\./);
            });
    });

    it ("Validates inputSource", async () => {
        // inputSource is required
        await kickOff({ inputSource: undefined })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'The "inputSource" JSON parameter is required');
            });

        // inputSource must be a string
        await kickOff({ inputSource: 777 })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'The "inputSource" JSON parameter must be a string');
            });

        // inputSource must be an URL
        await kickOff({ inputSource: "test" })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'The "inputSource" JSON parameter must be an URL');
            });
    });

    it ("Validates storageDetail", async () => {
        // if set, storageDetail must be an object (it defaults to { type: "https" })
        await kickOff({ storageDetail: "test" })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'The "storageDetail" JSON parameter must be an object');
            });

        // storageDetail.type must be one of "https", "aws-s3", "gcp-bucket", "azure-blob"
        await kickOff({ storageDetail: { type: "test" } })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.match(outcome.issue[0].diagnostics, /^The "storageDetail\.type" parameter must be one of "https",.+/);
            });
    });

    it ("Validates input[]", async () => {
        // input must be an array
        await kickOff({ input: "test" })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'The input must be an array');
            });

        // input cannot be empty
        await kickOff({ input: [] })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'The input array cannot be empty');
            });

        // input entries must be objects
        await kickOff({ input: [ "test" ] })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, 'All input entries must be objects');
            });

        // input entry.type must be string
        await kickOff({ input: [ {} ] })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "All input entries must have 'type' string property");
            });
        await kickOff({ input: [ { type: 777 } ] })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "All input entries must have 'type' string property");
            });


        // input entry.url must be string URL
        await kickOff({ input: [ { type: "test" } ] })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "All input entries must valid 'url' property");
            });
        await kickOff({ input: [ { type: "test", url: 777 } ] })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "All input entries must valid 'url' property");
            });
        await kickOff({ input: [ { type: "test", url: "test" } ] })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "All input entries must valid 'url' property");
            });
    });

    it ("Replies with OperationOutcome in case of error");

    it ("Replies with 202, OperationOutcome and Content-Location header");
});

describe("Import status endpoint", () => {
    it ("Replies with 404 and OperationOutcome for unknown task IDs");
    it ("Replies with 200 JSON and Expires header on completed import");
    it ("Replies with 202 and retry-after and x-progress headers on progress");
});

describe("Import cancellation endpoint", () => {

    it ("Replies with 404 and OperationOutcome for unknown task IDs", () => {
        return lib.requestPromise({
            url: lib.buildUrl(["/byron/fhir/import-status/whatever"]),
            method: "DELETE"
        })
        .then(() => { throw new Error("Did not fail as expected"); })
        .catch(error => {
            assert.equal(error.response.statusCode, 404);
            const outcome = JSON.parse(error.response.body);
            assert.equal(outcome.issue[0].diagnostics, 'Unknown procedure. Perhaps it is already completed and thus, it cannot be canceled');
        })
    });

    it ("Replies with 202 and OperationOutcome for canceled tasks", () => {
        const task = new Task();
        TaskManager.add(task);
        return lib.requestPromise({
            url: lib.buildUrl(["/byron/fhir/import-status/", task.id]),
            method: "DELETE"
        }).then(res => {
            assert.equal(res.statusCode, 202);
            const outcome = JSON.parse(res.body);
            assert.equal(outcome.issue[0].diagnostics, 'The procedure was canceled');
        })
    });
});
