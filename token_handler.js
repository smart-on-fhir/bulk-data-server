const jwt       = require("jsonwebtoken");
const jwkToPem  = require("jwk-to-pem");
const config    = require("./config");
const Lib       = require("./lib");
const { validateScopesForBulkDataExport, ScopeList } = require("./scope");

module.exports = async (req, res) => {

    // Require "application/x-www-form-urlencoded" POSTs -----------------------
    let ct = req.headers["content-type"] || "";
    if (ct.indexOf("application/x-www-form-urlencoded") !== 0) {
        return Lib.replyWithOAuthError(res, "invalid_request", {
            message: "form_content_type_required"
        });
    }

    // grant_type --------------------------------------------------------------
    if (!req.body.grant_type) {
        return Lib.replyWithOAuthError(res, "invalid_grant", {
            message: "Missing grant_type parameter"
        });
    }

    if (req.body.grant_type != "client_credentials") {
        return Lib.replyWithOAuthError(res, "unsupported_grant_type", {
            message: "The grant_type parameter should equal 'client_credentials'"
        });
    }

    // client_assertion_type ---------------------------------------------------
    if (!req.body.client_assertion_type) {
        return Lib.replyWithOAuthError(res, "invalid_request", {
            message: "missing_client_assertion_type"
        });
    }

    if (req.body.client_assertion_type != "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") {
        return Lib.replyWithOAuthError(res, "invalid_request", {
            message: "invalid_client_assertion_type"
        });
    }

    // client_assertion must be a token ----------------------------------------
    let authenticationToken;
    try {
        authenticationToken = Lib.parseToken(req.body.client_assertion);
    } catch (ex) {
        return Lib.replyWithOAuthError(res, "invalid_request", {
            message: "invalid_registration_token",
            params : [ ex.message ]
        });
    }

    // The client_id must be a token -------------------------------------------
    let clientDetailsToken;
    try {
        clientDetailsToken = Lib.parseToken(authenticationToken.sub);
    } catch (ex) {
        return Lib.replyWithOAuthError(res, "invalid_request", {
            message: "invalid_client_details_token",
            params : [ ex.message ]
        });
    }

    // simulate expired_registration_token error -------------------------------
    if (clientDetailsToken.err == "token_expired_registration_token") {
        return Lib.replyWithOAuthError(res, "invalid_grant", {
            message: "token_expired_registration_token"
        });
    }

    // Validate authenticationToken.aud (must equal this url) ------------------
    let tokenUrl = config.baseUrl + req.originalUrl;
    if (tokenUrl.replace(/^https?/, "") !== authenticationToken.aud.replace(/^https?/, "")) {
        return Lib.replyWithOAuthError(res, "invalid_grant", {
            message: "invalid_aud",
            params: [ tokenUrl ]
        });
    }

    // Validate authenticationToken.iss (must equal whatever the user entered at
    // registration time, i.e. clientDetailsToken.iss)
    if (authenticationToken.iss && authenticationToken.iss !== authenticationToken.sub) {
        return Lib.replyWithOAuthError(res, "invalid_grant", {
            message: "invalid_token_iss",
            params: [ authenticationToken.iss, authenticationToken.sub ]
        });
    }

    // simulated invalid_jti error ---------------------------------------------
    if (clientDetailsToken.err == "invalid_jti") {
        return Lib.replyWithOAuthError(res, "invalid_grant", {
            message: "invalid_jti"
        });
    }

    // Validate scope ----------------------------------------------------------
    // Note that the scope check is FHIR version dependent and makes sure that
    // no unknown resources are involved. However, this code is common for every
    // FHIR version so we just use "4" here.
    let tokenError = await validateScopesForBulkDataExport(req.body.scope, 4);
    if (tokenError) {
        return res.status(400).json({
            error: "invalid_scope",
            error_description: tokenError
        });
    }

    // simulated token_invalid_scope -------------------------------------------
    if (clientDetailsToken.err == "token_invalid_scope") {
        return Lib.replyWithOAuthError(res, "invalid_scope", {
            message: "token_invalid_scope"
        });
    }

    // Get the authentication token header
    let decodedToken = jwt.decode(req.body.client_assertion, { complete: true, json: true });
    if (!decodedToken) {
        return Lib.replyWithOAuthError(res, "invalid_client", {
            message: "sim_invalid_token",
            code   : 400
        });
    }

    let header = decodedToken.header;

    // Get the "kid" from the authentication token header
    let kid = header.kid;

    // If the jku header is present, verify that the jku is whitelisted
    // (i.e., that it matches the value supplied at registration time for
    // the specified `client_id`).
    // If the jku header is not whitelisted, the signature verification fails.
    if (header.jku && header.jku !== clientDetailsToken.jwks_url) {
        return Lib.replyWithOAuthError(res, "invalid_grant", {
            message: "jku_not_whitelisted",
            params: [ header.jku, clientDetailsToken.jwks_url ]
        });
    }


    // Start a task to fetch the JWKS
    Promise.resolve()

    .then(() => {

        // Case 1: Remote JWKS -------------------------------------------------
        // If the jku header is whitelisted, create a set of potential keys
        // by dereferencing the jku URL
        if (header.jku && clientDetailsToken.jwks_url) {
            return Lib.fetchJwks(clientDetailsToken.jwks_url)
                .then(json => {
                    if (!Array.isArray(json.keys)) {
                        Lib.replyWithOAuthError(res, "invalid_grant", {
                            message: "The remote jwks object has no keys array."
                        });
                        return Promise.reject();
                    }
                    return json.keys
                }).catch(error => {
                    Lib.replyWithOAuthError(res, "invalid_client", {
                        message: "Requesting the remote JWKS returned an error.\n" + error
                    });
                    return Promise.reject();
                });
        }

        // Case 2: Remote + local JWKS -----------------------------------------
        // If jku is absent, create a set of potential key sources consisting of:
        // all keys found by dereferencing the registration-time JWKS URI (if any)
        // + any keys supplied in the registration-time JWKS (if any)
        if (clientDetailsToken.jwks_url) {
            return Lib.fetchJwks(clientDetailsToken.jwks_url)
                .then(json => json.keys)
                .then(keys => {
                    // keys supplied in the registration-time JWKS (if any)
                    if (clientDetailsToken.jwks) {
                        keys = keys.concat(clientDetailsToken.jwks.keys);
                    }
                    return keys;
                }).catch(error => {
                    Lib.replyWithOAuthError(res, "invalid_client", {
                        message: "Requesting the remote JWKS returned an error.\n" + error
                    });
                    return Promise.reject();
                });
        }

        // Case 3: Local JWKS --------------------------------------------------
        if (clientDetailsToken.jwks && typeof clientDetailsToken.jwks == "object") {
            if (!Array.isArray(clientDetailsToken.jwks.keys)) {
                Lib.replyWithOAuthError(res, "invalid_grant", {
                    message: "The registration-time jwks object has no keys array."
                });
                return Promise.reject();
            }
            return clientDetailsToken.jwks.keys;
        }

        // Case 4: No JWKS -----------------------------------------------------
        Lib.replyWithOAuthError(res, "invalid_grant", {
            message: "No JWKS found. No 'jku' token header is set, no " +
                "registration-time jwks_url is available and no " +
                "registration-time jwks is available."
        });
        return Promise.reject();
    })

    // Filter the potential keys to retain only those where the `kid` matches
    // the value supplied in the client's JWK header.
    .then(keys => {

        let publicKeys = keys.filter(key => {
            if (Array.isArray(key.key_ops) && key.key_ops.indexOf("verify") == -1) {
                return false;
            }
            // return (key.kid === kid && key.kty === header.kty);
            return key.kid === kid;
        });

        if (!publicKeys.length) {
            Lib.replyWithOAuthError(res, "invalid_grant", {
                message: `No public keys found in the JWKS with "kid" equal to "${kid}"`
            });
            return Promise.reject();
        }

        return publicKeys;
    })

    // Attempt to verify the JWK using each key in the potential keys list.
    // - If any attempt succeeds, the signature verification succeeds.
    // - If all attempts fail, the signature verification fails.
    .then(publicKeys => {

        let error = "";
        let success = publicKeys.some(key => {
            /**
             * @type {import("jsonwebtoken").Algorithm}
             */
            const algorithm = key.alg;
            try {
                jwt.verify(
                    req.body.client_assertion,
                    jwkToPem(key),
                    { algorithms: [algorithm] }
                );
                return true;
            } catch(ex) {
                // console.error(ex);
                error = ex.message;
                return false;
            }
        });

        if (!success) {

            Lib.replyWithOAuthError(res, "invalid_grant", {
                message: "Unable to verify the token with any of the public keys found in the JWKS: " + error
            });
            return Promise.reject();
        }
    })

    .then(() => {
        if (clientDetailsToken.err == "token_invalid_token") {
            Lib.replyWithOAuthError(res, "invalid_client", {
                message: "sim_invalid_token",
                code   : 401
            });
            return Promise.reject();
        }
    })
    .then(() => ScopeList.fromString(req.body.scope).negotiateForExport(4))
    .then(grantedScopes => {
        if (!grantedScopes.length) {
            Lib.replyWithOAuthError(res, "invalid_scope", {
                message: `No access could be granted for scopes "${req.body.scope}".`
            });
            return Promise.reject();
        }
    
        // Here, expiresIn is set to the server settings for token lifetime.
        // However, if the authentication token has shorter lifetime it will
        // also be used for the access token.
        const expiresIn = Math.round(Math.min(
            authenticationToken.exp - Math.floor(Date.now() / 1000),
            clientDetailsToken.accessTokensExpireIn ?
                clientDetailsToken.accessTokensExpireIn * 60 :
                config.defaultTokenLifeTime * 60
        ));

        var token = Object.assign({}, clientDetailsToken.context, {
            token_type: "bearer",
            scope     : grantedScopes.join(" "),
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
    .catch(e => res.end(String(e  || "")));
};
