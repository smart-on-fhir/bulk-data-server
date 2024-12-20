import { Coding, Identifier } from "fhir/r4";
import { assert }             from "../lib";

/**
 * A token type is a parameter that provides a close to exact match search on a
 * string of characters, potentially scoped by a URI. It is mostly used against
 * a code or identifier datatype where the value may have a URI that scopes its
 * meaning, where the search is performed against the pair from a Coding or an
 * Identifier. Tokens are also used against other fields where exact matches are
 * required - uris, booleans, ContactPoints, and ids. In these cases the URI
 * portion ([system]|) is not used (only the [code] portion).
 * 
 * For tokens, matches are literal (e.g. not based on subsumption or other code
 * system features). Match is case sensitive unless the underlying semantics for
 * the context indicate that the token should be interpreted case-insensitively
 * (see, e.g. CodeSystem.caseSensitive). Note that matches on _id are always
 * case sensitive. If the underlying datatype is string then the search is not
 * case sensitive.
 * 
 * Note: There are many challenging issues around case sensitivity and token
 * searches. Some code systems are case sensitive (e.g. UCUM) while others are
 * known not to be. For many code systems, it's ambiguous. Other kinds of values
 * are also ambiguous. When in doubt, servers SHOULD treat tokens in a
 * case-insensitive manner, on the grounds that including undesired data has
 * less safety implications than excluding desired behavior. Clients SHOULD
 * always use the correct case when possible, and allow for the server to
 * perform case-insensitive matching.
 */
export default class Token
{
    public value;
    // underlying datatype ?
    // case sensitive ?

    constructor(value: string | Coding | Identifier) {
        this.value = value
    }

    match(parameterValue: string, modifier?: string) {

        if (modifier) {
            return this.modifiedMatch(modifier, parameterValue)
        }
        

        // [parameter]=[code] - the value of [code] matches a Coding.code or
        // Identifier.value irrespective of the value of the system property
        if (!parameterValue.includes("|")) {
            // console.log("===>", this.value, parameterValue)
            if (typeof this.value === "string") {
                return this.value === parameterValue
            }
            if ((this.value as Coding).code) {
                return (this.value as Coding).code === parameterValue
            }
            if ((this.value as Identifier).value) {
                return (this.value as Identifier).value === parameterValue
            }
            throw new Error(`Failed searching for "${parameterValue}"`)
        }

        const [system, code] = parameterValue.split("|");
        assert(system || code, `Failed searching for "${parameterValue}"`)
        assert(typeof this.value !== "string", `Searching with "|" can only be used against Coding ot Identifier values`)

        // [parameter]=[system]| - any element where the value of [system]
        // matches the system property of the Identifier or Coding
        if (!code) {
            return this.value.system === system
        }

        // [parameter]=|[code] - the value of [code] matches a Coding.code
        // or Identifier.value, and the Coding/Identifier has no system property
        if (!system) {
            if (this.value.system) {
                return false
            }
            if ((this.value as Coding).code) {
                return (this.value as Coding).code === code
            }
            if ((this.value as Identifier).value) {
                return (this.value as Identifier).value === code
            }
            throw new Error(`Failed searching for "${parameterValue}"`)
        }

        // [parameter]=[system]|[code] - the value of [code] matches a
        // Coding.code or Identifier.value, and the value of [system] matches
        // the system property of the Identifier or Coding
        if (this.value.system !== system) {
            return false
        }
        if ((this.value as Coding).code) {
            return (this.value as Coding).code === code
        }
        if ((this.value as Identifier).value) {
            return (this.value as Identifier).value === code
        }
        throw new Error(`Failed searching for "${parameterValue}"`)
    }

    modifiedMatch(modifier: string, parameterValue: string): boolean {
        switch (modifier) {
            case "not":
                return !this.match(parameterValue)
            case "text":
                return this.text(parameterValue)
            case "code-text":
                return this.codeText(parameterValue)
            case "of-type":
                return this.ofType(parameterValue)
            default:
                throw new Error(`Unsupported search modifier "${modifier}" for token fields`);
        }
    }

    /**
     * Tests whether the textual value in a resource (e.g.,
     * CodeableConcept.text, Coding.display, Identifier.type.text, or
     * Reference.display) matches the supplied parameter value using
     * basic string matching (begins with or is, case-insensitive).
     */
    text(parameterValue: string) {
        if (typeof this.value === "string") {
            return this.value.toLowerCase().startsWith(parameterValue.toLowerCase())
        }
        const value = this.value as any
        const resourceValue = value.text ?? value.display ?? value.type.text
        return resourceValue && resourceValue.toLowerCase().startsWith(parameterValue.toLowerCase())
    }
    
    codeText(parameterValue: string) {
        const value = this.value as any
        const resourceValue = value.text ?? value.display
        return resourceValue && resourceValue.toLowerCase().startsWith(parameterValue.toLowerCase())
    }

    ofType(parameterValue: string) {
        return (this.value as Identifier).value === parameterValue.toLowerCase()
    }
}
