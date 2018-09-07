const PORT = process.env.PORT || (process.env.NODE_ENV == "test" ? 9444 : 9443);
module.exports = {

    baseUrl: process.env.BASE_URL || `http://localhost:${PORT}`,

    port: PORT,

    throttle: 1,
    
    // Max. number of fhir resources (lines) in one ndjson file
    defaultPageSize: 10000,

    // Pretend that we are creating files for 10 seconds
    defaultWaitTime: 10,

    // Default Token LifeTime in minutes
    defaultTokenLifeTime: 15,

    // The maximum number of files that can be downloaded
    maxFiles: 150,

    // How many rows to select (load into memory and then stream them one by one).
    // The bigger the number the fewer sql queries will be executed but more
    // memory will be needed to store those bigger chunks of data
    rowsPerChunk: 500,

    jwtSecret: process.env.SECRET || "this-is-our-big-secret",

    errors: {
        "missing_parameter"               : "Missing %s parameter",
        "invalid_parameter"               : "Invalid %s parameter",
        "form_content_type_required"      : "Invalid request content-type header (must be 'application/x-www-form-urlencoded')",
        "sim_invalid_token"               : "Simulated invalid token error",
        "invalid_token"                   : "Invalid token: %s",
        "missing_client_assertion_type"   : "Missing client_assertion_type parameter",
        "invalid_client_assertion_type"   : "Invalid client_assertion_type parameter. Must be 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'.",
        "invalid_jti"                     : "Invalid 'jti' value",
        "invalid_aud"                     : "Invalid token 'aud' value. Must be '%s'.",
        "invalid_token_iss"               : "The given service url '%s' does not match the registered '%s'",
        "token_expired_registration_token": "Registration token expired",
        "invalid_registration_token"      : "Invalid registration token: %s",
        "invalid_client_details_token"    : "Invalid client details token: %s",
        "invalid_scope"                   : 'Invalid scope: "%s"',
        "missing_scope"                   : "Empty scope",
        "token_invalid_scope"             : "Simulated invalid scope error",
        "bad_grant_type"                  : "Unknown or missing grant_type parameter",
        "file_expired"                    : 'The requested file "%s" is missing or expired',
        "file_generation_failed"          : "File generation failed",
        "only_json_supported"             : "Only the JSON format is supported",
        "jku_not_whitelisted"             : "The provided jku '%s' is different than the one used at registration time (%s)",
        "__custom__"                      : "%s"
    }
};