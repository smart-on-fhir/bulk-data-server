const express      = require("express");
const bodyParser   = require("body-parser");
const config       = require("./config");
const Lib          = require("./lib");
const DB           = require("./db");
const generator    = require("./generator");
const tokenHandler = require("./token_handler");
const register     = require("./registration_handler");
const bulkData     = require("./bulk_data_handler");
const env          = require("./env");
const morgan       = require("morgan");



const app = express();
const router = express.Router();



if (process.env.NODE_ENV != "test") {
    router.use(morgan("combined"));
}

// HTTP to HTTPS redirect (this is Heroku-specific!)
/*router.use((req, res, next) => {
    let proto = req.headers["x-forwarded-proto"];
    let host  = req.headers.host;
    if (proto && (`${proto}://${host}` !== config.baseUrl)) { 
        return res.redirect(301, config.baseUrl + req.url);
    }
    console.log("Hitting this part!");
    next();
});*/

// backend services authorization
router.post("/auth/token", bodyParser.urlencoded({ extended: false }), tokenHandler);

// backend services registration
router.post("/auth/register", bodyParser.urlencoded({ extended: false }), register);

// Used as JWKS generator
router.use("/generator", generator);

// host env vars for the client-side
router.get("/env.js", env);

// Send some of the server config vars to the client
router.get("/server-config.js", (req, res) => {
    res.type("javascript").send(
    `var CFG = {
    defaultPageSize: ${config.defaultPageSize},
    defaultWaitTime: ${config.defaultWaitTime},
    defaultTokenLifeTime: ${config.defaultTokenLifeTime}\n};`);
});

// bulk data implementation
router.use(["/:sim/fhir", "/fhir"], bulkData);

// static files
router.use(express.static("static"));

// global error handler
router.use(function (err, req, res, next) {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

if (!module.parent) {
    app.use('/bulk-data-server', router);

    app.listen(config.port, function() {
        console.log("Server listening at " + config.baseUrl);
    });
}



module.exports = app;
