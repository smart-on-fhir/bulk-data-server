/**
 * This class tries to make it easier and cleaner to work with scopes (mostly by
 * using the two major methods - "has" and "matches").
 */
class ScopeSet
{
    /**
     * Parses the input string (if any) and initializes the private state vars
     * @param {String} str 
     */
    constructor(str = "") {
        this._scopesString = String(str).trim();
        this._scopes = this._scopesString.split(/\s+/).filter(Boolean);
    }

    /**
     * Checks if there is a scope that matches exactly the given string
     * @param {String} scope The scope to look for
     * @returns {Boolean} 
     */
    has(scope) {
        return this._scopes.indexOf(scope) > -1;
    }

    /**
     * Checks if there is a scope that matches by RegExp the given string
     * @param {RegExp} scope The pattern to look for
     * @returns {Boolean} 
     */
    matches(scopeRegExp) {
        return this._scopesString.search(scopeRegExp) > -1;
    }

    /**
     * Adds new scope to the set unless it already exists
     * @param {String} scope The scope to add
     * @returns {Boolean} true if the scope was added and false otherwise
     */
    add(scope) {
        if (this.has(scope)) {
            return false;
        }

        this._scopes.push(scope);
        this._scopesString = this._scopes.join(" ");
        return true;
    }

    /**
     * Removes a scope to the set unless it does not exist.
     * @param {String} scope The scope to remove
     * @returns {Boolean} true if the scope was removed and false otherwise
     */
    remove(scope) {
        let index = this._scopes.indexOf(scope);
        if (index < 0) {
            return false;
        }
        this._scopes.splice(index, 1);
        this._scopesString = this._scopes.join(" ");
        return true;
    }

    /**
     * Converts the object to string which is the space-separated list of scopes
     * @returns {String}
     */
    toString() {
        return this._scopesString;
    }

    /**
     * Converts the object to JSON which is an arrays of scope strings
     * @returns {Array<String>}
     */
    toJSON() {
        return this._scopes;
    }

    /**
     * Checks if the given scopes string is valid for use by backend services.
     * This will only accept system scopes and will also reject empty scope.
     * @param {String} scopes The scopes to check
     * @returns {String} The invalid scope or empty string on success
     * @static
     */
    static getInvalidSystemScopes(scopes) {
        scopes = String(scopes || "").trim();
    
        if (!scopes) {
            return config.errors.missing_scope;
        }
    
        scopes = scopes.split(/\s+/);
    
        return scopes.find(s => !(
            /^system\/(\*|[A-Z][a-zA-Z]+)(\.(read|write|\*))?$/.test(s)
        )) || "";
    }
}

module.exports = ScopeSet;
