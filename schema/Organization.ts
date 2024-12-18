import { Organization } from "fhir/r4";

export default {
    "type": "Organization",
    "profile": "http://hl7.org/fhir/StructureDefinition/Organization",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "identifier",
            "type": "token",
            "documentation": "Any identifier for the organization (not the accreditation issuer's identifier)"
        },
        {
            "name": "partof",
            "type": "reference",
            "documentation": "An organization of which this organization forms a part"
        },
        {
            "name": "address",
            "type": "string",
            "documentation": "A server defined search that may match any of the string fields in the Address, including line, city, district, state, country, postalCode, and/or text",
            resolver(res: Organization) {
                const out: string[] = []
                res.address?.forEach(n => {
                    out.push([
                        ...(n.line || []).join(", "),
                        n.city,
                        n.country,
                        n.state,
                        n.postalCode,
                    ].filter(Boolean).join(" "))
                })
                return out
            }
        },
        {
            "name": "address-state",
            "type": "string",
            "documentation": "A state specified in an address",
            resolver: (res: Organization) => {
                const out: string[] = []
                res.address?.forEach(x => {
                    if (x.state) {
                        out.push(x.state)
                    }
                })
                return out
            }
        },
        {
            "name": "active",
            "type": "token",
            "documentation": "Is the Organization record active",
            resolver: (res: Organization) => res.active === false ? "false" : "true"
        },
        {
            "name": "type",
            "type": "token",
            "documentation": "A code for the type of organization",
            resolver: (res: Organization) => {
                const out: any[] = []
                res.type?.forEach(x => {
                    if (x.coding) {
                        out.push(...x.coding)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "address-postalcode",
            "type": "string",
            "documentation": "A postal code specified in an address",
            resolver: (res: Organization) => {
                const out: string[] = []
                res.address?.forEach(x => {
                    if (x.postalCode) {
                        out.push(x.postalCode)
                    }
                })
                return out
            }
        },
        {
            "name": "address-country",
            "type": "string",
            "documentation": "A country specified in an address",
            resolver: (res: Organization) => {
                const out: string[] = []
                res.address?.forEach(x => {
                    if (x.country) {
                        out.push(x.country)
                    }
                })
                return out
            }
        },
        {
            "name": "endpoint",
            "type": "reference",
            "documentation": "Technical endpoints providing access to services operated for the organization"
        },
        {
            "name": "address-use",
            "type": "token",
            "documentation": "A use code specified in an address",
            resolver: (res: Organization) => {
                const out: string[] = []
                res.address?.forEach(x => {
                    if (x.use) {
                        out.push(x.use)
                    }
                })
                return out
            }
        },
        {
            "name": "name",
            "type": "string",
            "documentation": "A portion of the organization's name or alias",
            resolver: (res: Organization) => res.name || res.alias
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: Organization) => res.id
        },
        {
            "name": "address-city",
            "type": "string",
            "documentation": "A city specified in an address",
            resolver: (res: Organization) => {
                const out: string[] = []
                res.address?.forEach(x => {
                    if (x.city) {
                        out.push(x.city)
                    }
                })
                return out
            },
        }
    ]
}