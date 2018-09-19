const jwt    = require("jsonwebtoken");
const config = require("./config");
const Lib    = require("./lib");


module.exports = (req, res) => {
        
    // Require "application/x-www-form-urlencoded" POSTs
    if (!req.headers["content-type"] || req.headers["content-type"].indexOf("application/x-www-form-urlencoded") !== 0) {
        return Lib.replyWithOAuthError(res, "invalid_request", {
            message: "form_content_type_required"
        });
    }

    // parse and validate the "dur" parameter
    let dur = parseInt(req.body.dur || config.defaultTokenLifeTime + "", 10);
    if (isNaN(dur) || !isFinite(dur) || dur < 0) {
        return Lib.replyWithOAuthError(res, "invalid_request", {
            message: "invalid_parameter",
            params: [ "dur" ]
        });
    }

    // Clients can register either by JWKS or by JWKS URL
    let jwks     = String(req.body.jwks     || "").trim();
    let jwks_url = String(req.body.jwks_url || "").trim();
    if (!jwks && !jwks_url) {
        return Lib.replyWithOAuthError(res, "invalid_request", {
            message: "Either 'jwks' or 'jwks_url' is required"
        });
    }

    // Build the result token
    let jwtToken = {
        jwks    : jwks ? JSON.parse(jwks) : undefined,
        jwks_url: jwks_url || undefined
    };

    // Note that if dur is 0 accessTokensExpireIn will not be included
    if (dur) {
        jwtToken.accessTokensExpireIn = dur;
    }

    // Custom errors (if any)
    if (req.body.err) {
        jwtToken.err = req.body.err;
    }

    // Reply with signed token as text
    res.type("text").send(jwt.sign(jwtToken, config.jwtSecret, {
        keyid: "registration-token"
    }));
};
