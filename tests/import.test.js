
const DownloadTask = require("../import/DownloadTask");
const assert       = require("assert");
const { finished } = require("stream");
const config       = require("../config");
const NDJSONStream = require("../import/NDJSONStream");
const MockReadable = require("./mocks/ReadStream");
const mockServer   = require("./mocks/mockServer");
const lib          = require("./lib");
const { wait }     = require("../lib");
const Task         = require("../import/Task");
const TaskManager  = require("../import/TaskManager");
const Queue        = require("../import/Queue");

const MOCK_BASE_URL = "https://127.0.0.1:8443/";
// const API_BASE = MOCK_BASE_URL + "byron/fhir";

const validPayload = {
    "inputFormat": "application/fhir+ndjson",
    "inputSource": "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3",
    "storageDetail": {
        "type": "https"
    },
    "input": [
        {
            "type": "Patient",
            "url": "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Patient.ndjson"
        }
    ]
};


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
    });
}

async function bulkImport(payload)
{
    const kickOffResponse = await kickOff(payload);
    const statusLocation = kickOffResponse.headers["content-location"];

    async function waitForImport(delay)
    {
        if (delay) {
            await wait(delay);
        }

        const response = await lib.requestPromise({ url: statusLocation });

        if (response.statusCode == 200) {
            return {
                response,
                body: JSON.parse(response.body)
            };
        }

        if (response.statusCode == 202) {
            return await waitForImport(500);
        }

        throw new Error(`Unhandled statusCode "${response.statusCode}"`);
    }

    return await waitForImport();    
}


// Begin tests =================================================================
describe("BulkData Import", () => {

    before(next => {
        mockServer.httpsServer.listen("8443", next);
    });
    
    after(next => {
        mockServer.httpsServer.unref().close(next);
    });

    afterEach(next => {
        TaskManager.endAll();
        next();
    });

    describe("NDJSONStream", () => {

        it ("handles empty input", (next) => {
            const input = new MockReadable('', { highWaterMark: 3 });
            const ndjsonStream = new NDJSONStream();

            const result = [];
            
            ndjsonStream.on("data", object => result.push(object));
            
            finished(ndjsonStream, error => {
                assert.equal(error, null);
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
                assert.equal(error, null);
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
                assert.equal(error, null);
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
                assert.equal(error, null);
                assert.deepEqual(result, [{ "a" : 1 }, { "a": 2 }]);
                next();
            });

            input.pipe(ndjsonStream);
        });

        it ("handles json errors in ndjson files", (next) => {
            const input = new MockReadable('{"a:1}\n{"a":2}', { highWaterMark: 3 });
            const ndjsonStream = new NDJSONStream();

            finished(ndjsonStream, error => {
                assert.notEqual(error, null);
                assert.equal(error instanceof SyntaxError, true);
                assert.equal(error.message, "Error parsing NDJSON on line 1: Unexpected end of JSON input");
                next();
            });

            input.pipe(ndjsonStream);
        });

        it ("handles json errors on last line", (next) => {
            const input = new MockReadable('{"a":1}\n{"a":2', { highWaterMark: 3 });
            const ndjsonStream = new NDJSONStream();

            finished(ndjsonStream, error => {
                assert.notEqual(error, null);
                assert.equal(error instanceof SyntaxError, true);
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
                assert.notEqual(error, null);
                assert.equal(error instanceof Error, true);
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

        it ("handles invalid file types");
        it ("handles HTTP redirects");
        it ("enforces HTTP redirect limits");
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

        it ("auto-remove", async () => {
            const orig = config.dbMaintenanceMaxRecordAge;
            config.dbMaintenanceMaxRecordAge = 0;

            after(next => {
                config.dbMaintenanceMaxRecordAge = orig;
                next();
            });

            const task = new Task();
            TaskManager.add(task);
            task.end();
            await wait(10);
            assert.equal(TaskManager.has(task.id), false);
        });

        it ("Rejects adding the same task twice", () => {
            const task = new Task();
            TaskManager.add(task);
            assert.throws(() => TaskManager.add(task));
        });
    });

    describe("Queue", () => {

        it ("size()", () => {
            let queue = new Queue([1,2,3]);
            assert.equal(queue.size(), 3);

            queue = new Queue(1,2,3,4);
            assert.equal(queue.size(), 4);
        });

        it ("enqueue/dequeue", () => {
            let queue = new Queue();
            queue.enqueue(2);
            assert.equal(queue.dequeue(), 2);
        });

        it ("setMaxSize()", () => {
            let queue = new Queue([1,2,3]);
            queue.setMaxSize(3);
            assert.throws(() => queue.enqueue(4));
        });
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

        it ("Replies with 202, OperationOutcome and Content-Location header", async () => {
            const resp = await kickOff(validPayload);
            const json = JSON.parse(resp.body);
            assert.equal(resp.statusCode, 202);
            assert.equal(typeof resp.headers["content-location"], "string");
            assert.equal(json.resourceType, "OperationOutcome");
        });

        it ("Rejects multiple imports", async () => {

            // First request should succeed
            const resp1 = await kickOff(validPayload);
            assert.equal(resp1.statusCode, 202);

            // Second request should be rejected
            try {
                await kickOff(validPayload);
                throw new Error("Did not fail as expected");
            } catch (error) {
                assert.equal(error.response.statusCode, 429);
            }
        });
    });

    describe("Import status endpoint", () => {
        it ("Replies with 200 JSON and Expires header on completed import", async function() {
            this.timeout(10000);
            const { response } = await bulkImport(validPayload);
            assert.equal(response.statusCode, 200);
            assert.notEqual(response.headers["expires"], undefined);
        });

        it ("Replies with 404 and OperationOutcome for unknown task IDs", () => {
            return lib.requestPromise({
                url: lib.buildUrl(["/byron/fhir/import-status/whatever"])
            })
            .then(() => { throw new Error("Did not fail as expected"); })
            .catch(error => {
                assert.equal(error.response.statusCode, 404);
                const outcome = JSON.parse(error.response.body);
                assert.equal(outcome.issue[0].diagnostics, "Requested bulk import task not found");
            });
        });

        it ("Replies with 202 and retry-after and x-progress headers on progress", async function() {
            this.timeout(5000);
            const kickOffResponse = await kickOff(validPayload);
            const statusLocation = kickOffResponse.headers["content-location"];
            const statusResponse = await lib.requestPromise({ url: statusLocation });
            assert.equal(statusResponse.statusCode, 202);
            assert.notEqual(statusResponse.headers["retry-after"], undefined);
            assert.notEqual(statusResponse.headers["x-progress"], undefined);
        });

        it ("Fails of none of the files were imported", function(next) {

            this.timeout(5000);

            bulkImport({
                "inputFormat": "application/fhir+ndjson",
                "inputSource": "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3",
                "storageDetail": {
                    "type": "https"
                },
                "input": [
                    {
                        "type": "Patient",
                        "url": "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Fake.ndjson"
                    },
                    {
                        "type": "Observation",
                        "url": "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Missing.ndjson"
                    }
                ]
            }).then(
                () => next("Did not fail as expected"),
                () => next()
            );

            
        });

        it ("Reports errors in the error array", async function() {

            this.timeout(5000);

            const { body } = await bulkImport({
                "inputFormat": "application/fhir+ndjson",
                "inputSource": "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3",
                "storageDetail": {
                    "type": "https"
                },
                "input": [
                    {
                        "type": "Patient",
                        "url": "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Patient.ndjson"
                    },
                    {
                        "type": "Observation",
                        "url": "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Missing.ndjson"
                    }
                ]
            });

            assert.deepEqual(body.error, [{
                type: 'OperationOutcome',
                inputUrl: 'https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Missing.ndjson',
                count: 0,
                url: 'http://localhost:9444/outcome?httpCode=500&issueCode=exception&severity=error&message=Observation%20resources%20could%20not%20be%20imported.%20Error%3A%20404%20Not%20Found'
            }]);
        });

        it ("Enforces rate limits", () => {
            const orig = config.maxRequestsPerMinute;
            config.maxRequestsPerMinute = 2;

            after(next => {
                config.maxRequestsPerMinute = orig;
                next();
            });

            const url = lib.buildUrl(["/byron/fhir/import-status/whatever"]);
            let i = 0;

            function ping() {
                if (++i > 30) {
                    throw new Error("Did not fail in 30 attempts");
                }
                
                return lib.requestPromise({ url }).catch(error => {
                    if (error.response.statusCode != 429) {
                        return ping();
                    }
                });
            }

            return ping();
        });
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

});
