const fs      = require("fs");
const http    = require("http");
const https   = require("https");
const express = require("express");

const key  = fs.readFileSync(__dirname + "/self-signed.key", "utf8");
const cert = fs.readFileSync(__dirname + "/self-signed.crt", "utf8");


const app = express();

const mocks = [];

// @ts-ignore
app.mock  = mock => mocks.push(mock);

// @ts-ignore
app.clear = () => mocks.splice(0, mocks.length);


app.all("*", (req, res, next) => {
    if (!mocks.length) {
        return next(new Error("No mocks defined for this request"));
    }
    const settings = mocks.shift();

    setTimeout(() => {
        if (settings.headers) {
            res.set(settings.headers);
        }

        if (settings.status) {
            res.status(settings.status);
        }

        if (settings.body) {
            res.send(
                settings.body && typeof settings.body == "object" ?
                    JSON.stringify(settings.body) :
                    settings.body
            );
        }

        if (settings.file) {
            res.sendFile(settings.file, { root: __dirname });
        } else {
            res.end();
        }
    }, settings._delay || 0);
});

app.use((err, _req, res, _next) => {
    res.status(500).send(err.message);
});

const httpServer  = http.createServer(app);
const httpsServer = https.createServer({ key, cert }, app);

module.exports = {
    app,
    httpServer,
    httpsServer
};


// httpServer .listen(8080);
// httpsServer.listen(8443);

// console.log(
//     " http server listening at http://0.0.0.0:8080\n" +
//     "https server listening at https://0.0.0.0:8443\n"
// );

// if (!module.parent) {
//     const server = app.listen(3456, "0.0.0.0", () => {

//         /**
//          * @type any
//          */
//         const addr = server.address();
//         console.log(`Server listening at 0.0.0.0:${addr.port}`);
//     });
// }
