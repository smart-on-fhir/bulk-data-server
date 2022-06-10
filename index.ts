import express, { NextFunction, Request, Response } from "express"
import http           from "http"
import morgan         from "morgan"
import cors           from "cors"
import config         from "./config"
import generator      from "./generator"
import tokenHandler   from "./token_handler"
import register       from "./registration_handler"
import bulkData       from "./bulk_data_handler"
import env            from "./env"
import encodedOutcome from "./outcome_handler"

const app = express();

/* istanbul ignore if */
if (process.env.NODE_ENV === "production") {
    app.use(morgan("combined"));
}

// HTTP to HTTPS redirect (this is Heroku-specific!)
/* istanbul ignore next */
app.use((req, res, next) => {
    let proto = req.headers["x-forwarded-proto"];
    let host  = req.headers.host;
    if (proto && (`${proto}://${host}` !== config.baseUrl)) { 
        return res.redirect(301, config.baseUrl + req.url);
    }
    next();
});

// @ts-ignore backend services authorization
app.options("/auth/token", cors({ origin: true }));
// @ts-ignore 
app.post("/auth/token", cors({ origin: true }), express.urlencoded({ extended: false }), tokenHandler);

// @ts-ignore backend services registration
app.post("/auth/register", express.urlencoded({ extended: false }), register);

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

// Generic operation outcomes
app.use("/outcome", encodedOutcome);

// static files
app.use(express.static("static"));

// global error handler
/* istanbul ignore next */
app.use(function (err: Error, req: Request, res: Response, next: NextFunction) {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// If invoked directly start a server (otherwise let the tests do that)
/* istanbul ignore if */
// @ts-ignore
if (!module.parent) {
    app.listen(config.port, function() {
        console.log("Server listening at " + config.baseUrl);
    });
}

module.exports = {
    app,
    server: http.createServer(app)
};
