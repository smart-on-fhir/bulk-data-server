
// const request   = require("request");
// const base64url = require("base64-url");
// const moment    = require("moment");
const assert       = require("assert");
const { finished } = require("stream");

// const crypto    = require("crypto");
// const jwkToPem  = require("jwk-to-pem");
// const jwt       = require("jsonwebtoken");
const config       = require("../config");
// const DevNull      = require("../import/DevNull");
const NDJSONStream = require("../import/NDJSONStream");
const MockReadable = require("./mocks/ReadStream");
// const mockServer   = require("./mockServer");


// // @ts-ignore
// before(next => {
//     mockServer.httpServer.listen("8443", () => next());
// });

// // @ts-ignore
// after(next => {
//     mockServer.httpServer.close();
//     next();
// });


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

    it ("handles json errors in ndjson files", (next) => {
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
