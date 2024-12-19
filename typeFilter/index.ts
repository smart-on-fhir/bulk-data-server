import { FhirResource }              from "fhir/r4"
import fhirFilter                    from "fhir-filter/dist"
import FhirDate                      from "./FhirDate"
import Token                         from "./Token"
import FhirUri                       from "./FhirUri"
import FhirString                    from "./FhirString"
import FhirReference                 from "./FhirReference"
import SCHEMA, { SearchParamConfig } from "../schema"
import { JSONObject }                from "../types"

enum TYPES {
    reference,
    string,
    token,
    uri,
    quantity,
    date,
    number
}

enum PREFIX {
    /** the resource value is equal to or fully contained by the parameter value */
    eq,
    /** the resource value is not equal to the parameter value */
    ne,
    /** the resource value is greater than the parameter value */
    gt,
    /** the resource value is less than the parameter value */
    lt,
    /** the resource value is greater or equal to the parameter value */
    ge,
    /** the resource value is less or equal to the parameter value */
    le,
    /** the resource value starts after the parameter value */
    sa,
    /** the resource value ends before the parameter value */
    eb,
    /** the resource value is approximately the same to the parameter value (+- 10%)*/
    ap
}

interface Filter {
    parameter: string
    modifier : string
    value    : string
    prefix   : keyof typeof PREFIX
    type     : keyof typeof TYPES
}

function getSearchParamConfig(paramName: string, resource: FhirResource): SearchParamConfig {
    const searchConfig = SCHEMA[resource.resourceType]?.searchParam
    if (!searchConfig) {
        throw new Error(`Resources of type "${resource.resourceType}" do not support searching`)
    }
    const paramConfig = searchConfig.find(x => x.name === paramName);
    if (!paramConfig) {
        throw new Error(`Resources of type "${resource.resourceType}" do not support the "${paramName}" search parameter`)
    }
    return paramConfig
}

function resolveSearchParam(paramConfig: SearchParamConfig, resource: FhirResource) {
    if (typeof paramConfig.resolver === "function") {
        return paramConfig.resolver(resource)
    }
    return (resource as any)[paramConfig.name]
}

function parseFilterToken(key: string, value: string, resource: FhirResource): Filter {
    const [parameter, modifier] = key.split(":")
    const paramConfig = getSearchParamConfig(parameter, resource);
    const out: Filter = { modifier, parameter, value, type: paramConfig.type, prefix: "eq" }
    if (paramConfig.type === "date" || paramConfig.type === "number" || paramConfig.type === "quantity") {
        const prefix = value.substring(0, 2)
        if (prefix && prefix in PREFIX) {
            out.prefix = prefix as keyof typeof PREFIX
            out.value  = out.value.substring(2)
        }
    }
    return out
}

function matchesFilter(filter: Filter, resource: FhirResource): boolean {
    const paramConfig = getSearchParamConfig(filter.parameter, resource);
    const input       = resolveSearchParam(paramConfig, resource);

    if (filter.modifier === "missing") {
        assert(["true", "false"].includes(filter.value), `The value of "missing" search can only be 'true' or 'false'`)
        return filter.value === "true" ? input === undefined : input !== undefined
    }

    // date --------------------------------------------------------------------
    if (filter.type === "date") {
        if (filter.modifier) {
            throw new Error(`Unsupported search modifier "${filter.modifier}" for date fields`);
        }
        if (!input || !filter.value) {
            return false
        }
        const resourceValue  = new FhirDate(input)
        const parameterValue = new FhirDate(filter.value)
        return resourceValue[filter.prefix](parameterValue)
    }

    // token -------------------------------------------------------------------
    if (filter.type === "token") {
        if (Array.isArray(input)) {
            return input.some(i => new Token(i).match(filter.value, filter.modifier))
        }
        return new Token(input || "").match(filter.value, filter.modifier)
    }

    // string ------------------------------------------------------------------
    if (filter.type === "string") {
        if (Array.isArray(input)) {
            return input.some(i => new FhirString(i).match(filter.value, filter.modifier))
        }
        return new FhirString(input || "").match(filter.value, filter.modifier)
    }

    // reference ---------------------------------------------------------------
    if (filter.type === "reference") {
        if (Array.isArray(input)) {
            return input.some(i => new FhirReference(i).match(filter.value, filter.modifier))
        }
        return new FhirReference(input || "").match(filter.value, filter.modifier)
    }

    // uri ---------------------------------------------------------------------
    if (filter.type === "uri") {
        if (Array.isArray(input)) {
            return input.some(i => new FhirUri(i).match(filter.value, filter.modifier))
        }
        return new FhirUri(input || "").match(filter.value, filter.modifier)
    }

    return false
}

export function matches(query: string, resource: FhirResource)
{
    const params = new URLSearchParams(query)
    for (const [key, value] of params.entries()) {
        const f = parseFilterToken(key, value, resource)
        if (!matchesFilter(f, resource)) return false
    }
    return true
}

export function filter(resources: FhirResource[], query: string) {
    const params = new URLSearchParams(query)
    return resources.filter(resource => {
        for (const [key, value] of params.entries()) {
            const f = parseFilterToken(key, value, resource)
            if (matchesFilter(f, resource)) {
                return true
            }
        }
        return false
    })
}

/**
 * When using _typeFilter, each resource type is filtered independently. For
 * example, filtering Patient resources to people born after the year 2000 will
 * not filter Encounter resources for patients born before the year 2000 from
 * the export.
 * 
 * The value of the _typeFilter parameter is a FHIR REST API query. Resources
 * with a resource type specified in this query that do not meet the criteria in
 * the search expression in the query SHALL NOT be returned, with the exception
 * of related resources being included by a server to provide context about the
 * resources being exported (see processing model).
 * 
 * A client MAY repeat the _typeFilter parameter multiple times in a kick-off
 * request. When more than one _typeFilter parameter is provided with a query
 * for the same resource type, the server SHALL include resources of that
 * resource type that meet the criteria in any of the parameters (a logical "or").
 */
export function typeFilter(resources: FhirResource[], query: string | URLSearchParams) {
    query = new URLSearchParams(query)
    const typeFilters = query.getAll("_typeFilter").filter(Boolean)



    return resources.filter(resource => {
        return typeFilters.some(str => {
            const [resourceType, resourceQuery] = str.split("?")

            if (resource.resourceType !== resourceType) {
                return true
            }

            for (const [key, value] of new URLSearchParams(resourceQuery).entries()) {
                const values = value.split(",") // logical OR
                if (!values.some(val => {
                    const f = parseFilterToken(key, val, resource)
                    return matchesFilter(f, resource)
                })) {
                    return false
                }
            }

            return true
        })
    })
}

/**
 * Parses the _typeFilter query parameters and creates a function that can be
 * called against single resource to test if it should be excluded.
 */
export function createTypeFilterTester(typeFilters: string[]) {
    
    return function(resource: FhirResource) {
        return typeFilters.filter(Boolean).some(str => {

            if (str.startsWith("_filter=")) {
                return fhirFilter.create(str.substring(8))(resource as unknown as JSONObject)
            }

            const [resourceType, resourceQuery] = str.split("?")

            if (resource.resourceType !== resourceType) {
                return true
            }

            for (const [key, value] of new URLSearchParams(resourceQuery).entries()) {
                const values = value.split(",") // logical OR
                if (!values.some(val => {
                    const f = parseFilterToken(key, val, resource)
                    return matchesFilter(f, resource)
                })) {
                    return false
                }
            }

            return true
        })
    }
}

export function assert(condition: any, error?: string | ErrorConstructor, ctor: ErrorConstructor = Error): asserts condition {
    if (!(condition)) {
        if (typeof error === "function") {
            throw new error()
        }
        throw new ctor(error || "Assertion failed")
    }
}
