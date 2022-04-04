const { URLSearchParams }           = require("url");
const { getAvailableResourceTypes } = require("./lib");


class Scope
{

    /**
     * @type { "patient" | "user" | "system" }
     */
    level;

    /**
     * @type { string }
     */
    resource;

    /**
     * @type {Map} { create: boolean, read: boolean, update: boolean, delete: boolean, search: boolean }
     */
    actions;

    /**
     * @type {string} Currently supported values are "1" and "2"
     */
    verson;

    /**
     * Parse a string and return a Scope instance
     * @param {string} scopeString 
     * @returns {Scope}
     */
    static fromString(scopeString) {
        if (/^\s*(patient|user|system|\*)\/(\*|[A-Z][A-Za-z0-9]+)\.(read|write|\*)\s*$/.test(String(scopeString || ""))) {
            return new ScopeV1(scopeString)
        }
        return new ScopeV2(scopeString)
    }

    /**
     * @param {string} resourceType 
     * @param {string} access
     * @param {"*"|"system"|"patient"|"user"} level
     * @returns {boolean}
     */
    hasAccessTo(resourceType, access, level) {
        if (this.level !== "*" && this.level !== level) {
            return false;
        }

        if (this.resource !== "*" && this.resource !== resourceType) {
            return false;
        }

        const { create, read, update, delete: destroy, search } = this.actions;

        if (access === "*") {
            return create && destroy && read && search && update;
        }

        if (access === "read") {
            return read && search;
        }

        if (access === "write") {
            return create && destroy && update;
        }

        if (!(/^[cruds]$/).test(access)) {
            console.error(`Invalid access "${access}" requested`)
            return false
        }

        return access.split("").every(letter => {
            switch (letter) {
                case "c": return create;
                case "r": return read;
                case "u": return update;
                case "d": return destroy;
                case "s": return search;
            }
        });
    }
}

class ScopeV1 extends Scope
{
    /**
     * @param { string } scopeString
     */
    constructor(scopeString) {
        super();
        const SCOPE_RE = /^\s*(patient|user|system)\/(\*|[A-Z][A-Za-z0-9]+)\.(\*|read|write)\s*$/;
        const match = String(scopeString || "").match(SCOPE_RE);
        if (match) {
            const action = match[3];

            /**
             * @type { "patient" | "user" | "system" }
             */
            let level;

            // @ts-ignore
            level = match[1];

            this.level = level;

            this.resource = match[2];

            this.actions  = new Map([
                [ "create", action === "*" || action === "write" ],
                [ "read"  , action === "*" || action === "read"  ],
                [ "update", action === "*" || action === "write" ],
                [ "delete", action === "*" || action === "write" ],
                [ "search", action === "*" || action === "read"  ],
            ]);

            this.verson = "1"

        } else {
            throw new Error(`Invalid scope "${scopeString}"`);
        }
    }

    toString() {
        let out = `${this.level}/${this.resource}.`;

        let canRead   = this.actions.get("read") && this.actions.get("search")
        let canMutate = this.actions.get("create") && this.actions.get("update") && this.actions.get("delete")

        out += canRead && canMutate ? "*" : canMutate ? "write" : "read";

        return out;
    }
}

class ScopeV2 extends Scope
{
    /**
     * @type { URLSearchParams }
     */
    query;

    /**
     * @param { string } scopeString
     */
    constructor(scopeString) {
        super();
        const SCOPE_RE = /^\s*(patient|user|system)\/(\*|[A-Z][A-Za-z0-9]+)\.([cruds]+)(\?.*)?$/;
        const match = String(scopeString || "").match(SCOPE_RE);
        if (match) {
            const action = match[3];

            const map = new Map();

            const actionKeys = ["create", "read", "update", "delete", "search"];

            action.split("").forEach(key => {
                map.set(actionKeys.find(x => x[0] === key), true)
            });

            actionKeys.filter(x => !map.has(x)).forEach(x => map.set(x, false))

            /**
             * @type { "patient" | "user" | "system" }
             */
            let level;

            // @ts-ignore
            level = match[1];

            this.level    = level;
            this.resource = match[2];
            this.actions  = map;
            this.query    = new URLSearchParams(match[4]);
            this.verson   = "2"
        } else {
            throw new Error(`Invalid scope "${scopeString}"`);
        }
    }

    toString() {
        let out = `${this.level}/${this.resource}.`;

        for (let action of this.actions.keys()) {
            if (this.actions.get(action)) {
                out += action[0];
            }
        }

        const qs = this.query.toString();
        if (qs) {
            out += "?" + qs;
        }

        return out;
    }
}


class ScopeList
{
    /**
     * @type {Scope[]}
     */
    scopes;

    /**
     * @param {Scope[]} scopes
     */
    constructor(scopes = []) {
        this.scopes = scopes;
    }

    /**
     * Parse a string or comma separated list of scopes and return an array of
     * Scope instances
     * @param {string} listString 
     */
    static fromString(listString) {
        return new ScopeList(
            String(listString || "").trim().split(/\s+|\s*,\s*/).filter(Boolean).map(x => Scope.fromString(x))
        );
    }

    /**
     * Checks if the given scopes string is valid for use by backend services
     * for making bulk data exports. This will only accept system read and
     * search scopes and will also reject empty scope.
     * @param {number} [fhirVersion] The FHIR version that this scope should be
     * validated against. If provided, the scope should match one of the
     * resource types available in the database for that version (or *).
     * Otherwise no check is performed.
     * @returns {Promise<string>} The invalid scope or empty string on success
     */
    async validateForExport(fhirVersion = 0) {

        // Reject empty scope list
        if (!this.scopes.length) {
            return "Empty scope";
        }

        // Reject if any of the scopes requires access level other than "system"
        let badScope = this.scopes.find(x => x.level !== "system");
        if (badScope) {
            return `Only system-level scopes are allowed for bulk data export (bad scope: "${badScope}")`
        }

        // Reject if any of the scopes requires update, delete or create access
        badScope = this.scopes.find(x => x.actions.get("create"));
        if (badScope) {
            return `Cannot grant permissions to create resources requested by scope "${badScope}"`
        }

        badScope = this.scopes.find(x => x.actions.get("update"));
        if (badScope) {
            return `Cannot grant permissions to update resources requested by scope "${badScope}"`
        }

        badScope = this.scopes.find(x => x.actions.get("delete"));
        if (badScope) {
            return `Cannot grant permissions to delete resources requested by scope "${badScope}"`
        }

        // If no FHIR version is specified accept anything that looks like a
        // resourceType. Otherwise check the DB to see what types of resources
        // we have.
        if (fhirVersion) {
            let availableResources = await getAvailableResourceTypes(fhirVersion);
            badScope = this.scopes.find(x => !availableResources.includes(x.resource));
            if (badScope) {
                return `Resources of type "${badScope.resource}" do not exist on this server (requested by scope "${badScope}")`
            }
        }

        return "";
    }

    /**
     * Checks if the given scopes string is valid for use by backend services
     * for making bulk data exports. This will only accept system read and
     * search scopes and will also reject empty scope.
     * @param {number} [fhirVersion] The FHIR version that this scope should be
     * validated against. If provided, the scope should match one of the
     * resource types available in the database for that version (or *).
     * Otherwise no check is performed.
     * @returns {Promise<Scope[]>} The invalid scope or empty string on success
     */
    async negotiateForExport(fhirVersion = 0) {

        let scopes = [...this.scopes].filter(scope => {

            // Only system scopes can be used for export
            if (scope.level !== "system") {
                return false;
            }

            // Skip scopes without read access
            if (!scope.actions.get("read")) {
                return false;
            }

            scope.actions.set("create", false)
            scope.actions.set("update", false)
            scope.actions.set("delete", false)
            return true;
        });

        // If no FHIR version is specified accept anything that looks like a
        // resourceType. Otherwise check the DB to see what types of resources
        // we have.
        if (fhirVersion) {
            let availableResources = await getAvailableResourceTypes(fhirVersion);
            scopes = scopes.filter(scope => scope.resource === "*" || availableResources.includes(scope.resource));
        }

        return scopes;
    }
}

/**
 * 
 * @param {string} scopes 
 * @param {number} [fhirVersion]
 */
async function validateScopesForBulkDataExport(scopes, fhirVersion = 0) {
    try {
        var scopeList = ScopeList.fromString(scopes);
    } catch (ex) {
        return ex.message;
    }

    return await scopeList.validateForExport();
}


module.exports = {
    Scope,
    ScopeV1,
    ScopeV2,
    ScopeList,
    validateScopesForBulkDataExport
}