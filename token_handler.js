const crypto    = require("crypto");
const jwt       = require("jsonwebtoken");
const base64url = require("base64-url");
const jwkToPem  = require("jwk-to-pem");
const config    = require("./config");
const Lib       = require("./lib");
const ScopeSet  = require("./ScopeSet");

module.exports = (req, res) => {
        
    // Require "application/x-www-form-urlencoded" POSTs -----------------------
    let ct = req.headers["content-type"] || "";
    if (ct.indexOf("application/x-www-form-urlencoded") !== 0) {
        return Lib.replyWithError(res, "form_content_type_required", 401);
    }

    // grant_type must be "client_credentials" ---------------------------------
    if (req.body.grant_type != "client_credentials") {
        return Lib.replyWithError(res, "bad_grant_type", 400);
    }

    // client_assertion_type is required ---------------------------------------
    if (!req.body.client_assertion_type) {
        return Lib.replyWithError(res, "missing_client_assertion_type", 401);
    }

    // client_assertion_type must have a fixed value ---------------------------
    if (req.body.client_assertion_type != "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") {
        return Lib.replyWithError(res, "invalid_client_assertion_type", 401);
    }

    // client_assertion must be a token ----------------------------------------
    let authenticationToken;
    try {
        authenticationToken = Lib.parseToken(req.body.client_assertion);
    } catch (ex) {
        return Lib.replyWithError(res, "invalid_registration_token", 401, ex.message);
    }

    // The client_id must be a token -------------------------------------------
    let clientDetailsToken;
    try {
        clientDetailsToken = Lib.parseToken(authenticationToken.sub);
    } catch (ex) {
        return Lib.replyWithError(res, "invalid_client_details_token", 401, ex.message);
    }

    // simulate expired_registration_token error -------------------------------
    if (clientDetailsToken.err == "token_expired_registration_token") {
        return Lib.replyWithError(res, "token_expired_registration_token", 401);
    }

    // Validate authenticationToken.aud (must equal this url) ------------------
    let tokenUrl = config.baseUrl + req.originalUrl;
    if (tokenUrl.replace(/^https?/, "") !== authenticationToken.aud.replace(/^https?/, "")) {
        return Lib.replyWithError(res, "invalid_aud", 401, tokenUrl);
    }

    // Validate authenticationToken.iss (must equal whatever the user entered at
    // registration time, i.e. clientDetailsToken.iss)
    if (authenticationToken.iss !== clientDetailsToken.iss) {
        return Lib.replyWithError(res, "invalid_token_iss", 401, authenticationToken.iss, clientDetailsToken.iss);
    }

    // simulated invalid_jti error ---------------------------------------------
    if (clientDetailsToken.err == "invalid_jti") {
        return Lib.replyWithError(res, "invalid_jti", 401);
    }

    // Validate scope ----------------------------------------------------------
    let tokenError = ScopeSet.getInvalidSystemScopes(req.body.scope);
    if (tokenError) {
        return Lib.replyWithError(res, "invalid_scope", 401, tokenError);
    }

    // simulated token_invalid_scope -------------------------------------------
    if (clientDetailsToken.err == "token_invalid_scope") {
        return Lib.replyWithError(res, "token_invalid_scope", 401);
    }

    // Get the authentication token header
    let header = jwt.decode(
        req.body.client_assertion,
        { complete: true }
    ).header;

    // Get the "kid" from the authentication token header
    let kid = header.kid;
    if (!kid) {
        return Lib.replyWithError(res, "invalid_token", 401, `No "kid" found in the authentication token header`);
    }


    // Start a task to fetch the JWKS ------------------------------------------
    Promise.resolve()

    // If the jku header is present, verify that the jku is whitelisted
    // (i.e., that it matches the value supplied at registration time for
    // the specified `client_id`).
    // If the jku header is not whitelisted, the signature verification fails.
    .then(() => {
        if (header.jku) {
            if (header.jku !== clientDetailsToken.jwks_url) {
                throw new Error(
                    Lib.getErrorText(
                        "jku_not_whitelisted",
                        header.jku,
                        clientDetailsToken.jwks_url
                    )
                );
            }

            // If the jku header is whitelisted, create a set of potential
            // keys by dereferencing the jku URL.
            return Lib.fetchJwks(header.jku);
        }

        // If jku is absent, create a set of potential key sources consisting
        // of: all keys found by dereferencing the registration-time JWKS URI
        // (if any) + any keys supplied in the registration-time JWKS (if any).
        return clientDetailsToken.jwks;
    })

    // .then(jwks => {
    //     console.log(`Result from ${header.jku ? "JWKS URL" : "JWKS"}: `, jwks);
    //     return jwks;
    // })

    // Filter the potential keys to retain only those where the alg and
    // kid match the values supplied in the client's JWK header.
    .then(jwks => {

        let publicKeys = jwks.keys.filter(key => {
            return (
                key.kid === kid &&
                key.alg === header.alg &&
                Array.isArray(key.key_ops) &&
                key.key_ops.indexOf("verify") > -1
            );
        });

        if (!publicKeys.length) {
            throw new Error(
                `No public keys found in the JWKS with "kid" equal to "${kid
                }" and alg equal to "${header.alg}"`
            );
        }

        return publicKeys;
    })

    // .then(publicKeys => {
    //     console.log(`Keys from ${header.jku ? "JWKS URL" : "JWKS"}: `, publicKeys)
    //     return publicKeys;
    // })

    // Attempt to verify the JWK using each key in the potential keys list.
    // - If any attempt succeeds, the signature verification succeeds.
    // - If all attempts fail, the signature verification fails.
    .then(publicKeys => {

        let success = publicKeys.some(key => {
            try {
                jwt.verify(
                    req.body.client_assertion,
                    jwkToPem(key),
                    { algorithm: key.alg }
                );
                return true;
            } catch(ex) {
                console.error(ex);
                return false;
            }
        });

        if (!success) {
            throw new Error(
                `Unable to verify the token with any of the public keys found in the JWKS`
            );
        }
    })

    .then(() => {
        if (clientDetailsToken.err == "token_invalid_token") {
            return Lib.replyWithError(res, "sim_invalid_token", 401);
        }

        const expiresIn = clientDetailsToken.accessTokensExpireIn ?
            clientDetailsToken.accessTokensExpireIn * 60 :
            config.defaultTokenLifeTime * 60;

        var token = Object.assign({}, clientDetailsToken.context, {
            token_type: "bearer",
            scope     : clientDetailsToken.scope,
            client_id : req.body.client_id,
            expires_in: expiresIn
        });

        // sim_error
        if (clientDetailsToken.err == "request_invalid_token") {
            token.err = "Invalid token";
        } else if (clientDetailsToken.err == "request_expired_token") {
            token.err = "Token expired";
        }

    
        // access_token
        token.access_token = jwt.sign(token, config.jwtSecret, { expiresIn });

        res.json(token);
    })
    .catch(error  => Lib.replyWithError(res, "__custom__", 401, String(error)));
};
