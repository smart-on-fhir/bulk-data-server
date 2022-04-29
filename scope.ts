import { getAvailableResourceTypes } from "./lib"

type AccessLevel = "patient" | "user" | "system";
type Action = "create" | "read" | "update" | "delete" | "search";

// patient|user|system|*)/(*|resourceType).(read|write|*)
const re_scope_v1 = /^\s*(patient|user|system|\*)\/(\*|[A-Z][A-Za-z0-9]+)\.(read|write|\*)\s*$/;

// patient|user|system)/(*|resourceType).[cruds]?query
const re_scope_v2 = /^\s*(patient|user|system)\/(\*|[A-Z][A-Za-z0-9]+)\.([cruds]+)(\?.*)?$/

export abstract class Scope
{

    abstract level: string;

    abstract resource: string;

    abstract actions: Map<Action, boolean>;

    /**
     * @type Currently supported values are "1" and "2"
     */
    abstract verson: string;

    /**
     * Parse a string and return a Scope instance. The returned scope is either
     * ScopeV1 or ScopeV2 instance depending on the input string
     */
    static fromString(scopeString: string): Scope {
        if (re_scope_v1.test(String(scopeString || ""))) {
            return new ScopeV1(scopeString)
        }
        else if (re_scope_v2.test(String(scopeString || ""))) {
            return new ScopeV2(scopeString)
        }
        throw new Error(`Invalid scope "${scopeString}"`);
    }

    hasAccessTo(resourceType: string, access:string, level: "*"|"system"|"patient"|"user"): boolean {
        if (this.level !== "*" && this.level !== level) {
            return false;
        }

        if (this.resource !== "*" && this.resource !== resourceType) {
            return false;
        }

        const create  = !!this.actions.get("create");
        const read    = !!this.actions.get("read");
        const update  = !!this.actions.get("update");
        const destroy = !!this.actions.get("delete");
        const search  = !!this.actions.get("search");

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

export class ScopeV1 extends Scope
{
    level: AccessLevel;

    actions: Map<Action, boolean>;

    resource: string;

    verson = "1";

    constructor(scopeString: string) {
        super();
        const SCOPE_RE = /^\s*(patient|user|system)\/(\*|[A-Z][A-Za-z0-9]+)\.(\*|read|write)\s*$/;
        const match = String(scopeString || "").match(SCOPE_RE);
        if (match) {
            const action = match[3];

            this.level = match[1] as AccessLevel;

            this.resource = match[2];

            this.actions = new Map([
                [ "create", action === "*" || action === "write" ],
                [ "read"  , action === "*" || action === "read"  ],
                [ "update", action === "*" || action === "write" ],
                [ "delete", action === "*" || action === "write" ],
                [ "search", action === "*" || action === "read"  ],
            ]);

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

export class ScopeV2 extends Scope
{
    level: AccessLevel;

    actions: Map<Action, boolean>;

    resource: string;

    verson = "2";
    /**
     * @type { URLSearchParams }
     */
    query;

    constructor(scopeString: string) {
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

            this.level    = match[1] as AccessLevel;
            this.resource = match[2];
            this.actions  = map;
            this.query    = new URLSearchParams(match[4]);
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

export class ScopeList
{
    scopes: Scope[];

    constructor(scopes: Scope[] = []) {
        this.scopes = scopes;
    }

    /**
     * Parse a string or comma separated list of scopes and return an array of
     * Scope instances
     */
    static fromString(listString: string) {
        return new ScopeList(
            String(listString || "").trim().split(/\s+|\s*,\s*/)
            .filter(Boolean).map(x => Scope.fromString(x))
        );
    }

    /**
     * Checks if the given scopes string is valid for use by backend services
     * for making bulk data exports. This will only accept system read and
     * search scopes and will also reject empty scope.
     * @param [fhirVersion = 0] The FHIR version that this scope should be
     * validated against. If provided, the scope should match one of the
     * resource types available in the database for that version (or *).
     * Otherwise no check is performed.
     * @returns The invalid scope or empty string on success
     */
    async validateForExport(fhirVersion = 0): Promise<string> {

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
            badScope = this.scopes.find(x => x.resource !== "*" && !availableResources.includes(x.resource));
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
     * @param [fhirVersion = 0] The FHIR version that this scope should be
     * validated against. If provided, the scope should match one of the
     * resource types available in the database for that version (or *).
     * Otherwise no check is performed.
     * @returns The invalid scope or empty string on success
     */
    async negotiateForExport(fhirVersion = 0): Promise<Scope[]> {

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

export async function validateScopesForBulkDataExport(scopes: string, fhirVersion = 0) {
    try {
        var scopeList = ScopeList.fromString(scopes);
    } catch (ex) {
        return (ex as Error).message;
    }

    return await scopeList.validateForExport(fhirVersion);
}
