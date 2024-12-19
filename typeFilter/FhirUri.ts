
/**
 * The uri parameter refers to an element that contains a URI (RFC 3986 icon).
 * By default, matches are precise, case and accent sensitive, and the entire
 * URI must match. The modifier :above or :below can be used to indicate that
 * partial matching is used.
 */
export default class FhirUri
{
    protected value: string;

    constructor(value: string) {
        this.value = value
    }

    match(parameterValue: string, modifier?: string) {
        switch (modifier) {
            case "above":
                if (!parameterValue.match(/^https?\:\/\//)) {
                    throw new Error(`The :above modifier can only be used with URLs`);
                }
                return parameterValue.replace(/\?.*$/, "").startsWith(this.value.replace(/\?.*$/, ""))
            case "below":
                if (!parameterValue.match(/^https?\:\/\//)) {
                    throw new Error(`The :below modifier can only be used with URLs`);
                }
                return this.value.replace(/\?.*$/, "").startsWith(parameterValue.replace(/\?.*$/, ""))
            case undefined:
                return this.value === parameterValue;
            default:
                throw new Error(`Unsupported search modifier "${modifier}" for uri fields`);
        }
    }
}