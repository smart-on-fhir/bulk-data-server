const express      = require("express");
const bodyParser   = require("body-parser");
const config       = require("./config");
const Lib          = require("./lib");
const DB           = require("./db");
const generator    = require("./generator");
const tokenHandler = require("./token_handler");
const register     = require("./registration_handler");
const bulkData     = require("./bulk_data_handler");
const bulkImporter = require("./bulk_data_importer");
const env          = require("./env");
const morgan       = require("morgan");


const app = express();

if (process.env.NODE_ENV != "test") {
    app.use(morgan("combined"));
}

// HTTP to HTTPS redirect (this is Heroku-specific!)
app.use((req, res, next) => {
    let proto = req.headers["x-forwarded-proto"];
    let host  = req.headers.host;
    if (proto && (`${proto}://${host}` !== config.baseUrl)) { 
        return res.redirect(301, config.baseUrl + req.url);
    }
    next();
});

// backend services authorization
app.post("/auth/token", bodyParser.urlencoded({ extended: false }), tokenHandler);

// backend services registration
app.post("/auth/register", bodyParser.urlencoded({ extended: false }), register);

// Used as JWKS generator
app.use("/generator", generator);

// host env vars for the client-side
app.get("/env.js", env);

// Send some of the server config vars to the client
app.get("/server-config.js", (req, res) => {
    res.type("javascript").send(
    `var CFG = {
    defaultPageSize: ${config.defaultPageSize},
    defaultWaitTime: ${config.defaultWaitTime},
    defaultTokenLifeTime: ${config.defaultTokenLifeTime}\n};`);
});

// bulk data implementation
app.use(["/:sim/fhir", "/fhir"], bulkData);
// stub for developing bulk data import capability
app.use("/byron/fhir", bulkImporter);

// static files
app.use(express.static("static"));

// global error handler
app.use(function (err, req, res, next) {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

if (!module.parent) {
    app.listen(config.port, function() {
        console.log("Server listening at " + config.baseUrl);
    });
}

module.exports = app;
