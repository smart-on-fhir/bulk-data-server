import { Practitioner } from "fhir/r4";


export default {
    "type": "Practitioner",
    "profile": "http://hl7.org/fhir/StructureDefinition/Practitioner",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "given",
            "type": "string",
            "documentation": "A portion of the given name",
            resolver     : (res: Practitioner) => {
                const names: string[] = []
                res.name?.forEach(n => {
                    if (n.given) {
                        names.push(...n.given)
                    }
                })
                return names
            }
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "A practitioner's Identifier"
        },
        {
            "name": "address",
            "type": "string",
            "documentation": "A server defined search that may match any of the string fields in the Address, including line, city, district, state, country, postalCode, and/or text",
            resolver(res: Practitioner) {
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
            resolver     : (res: Practitioner) => {
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
            "name": "gender",
            "type": "token",
            "documentation": "Gender of the practitioner"
        },
        {
            "name": "active",
            "type": "token",
            "documentation": "Whether the practitioner record is active",
            resolver: (res: Practitioner) => res.active !== false ? "true" : "false"
        },
        {
            "name": "address-postalcode",
            "type": "string",
            "documentation": "A postalCode specified in an address",
            resolver     : (res: Practitioner) => {
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
            resolver     : (res: Practitioner) => {
                const out: string[] = []
                res.address?.forEach(x => {
                    if (x.country) {
                        out.push(x.country)
                    }
                })
                return out
            },
        },
        {
            "name": "phone",
            "type": "token",
            "documentation": "A value in a phone contact",
            resolver     : (res: Practitioner) => {
                const out = res.telecom?.filter(t => t.system === "phone")
                    .map(x => x.value)
                    .filter(Boolean);
                return out && out.length ? out : undefined
            }
        },
        {
            "name": "address-use",
            "type": "token",
            "documentation": "A use code specified in an address",
            resolver     : (res: Practitioner) => {
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
            "documentation": "A server defined search that may match any of the string fields in the HumanName, including family, give, prefix, suffix, suffix, and/or text",
            resolver     : (res: Practitioner) => {
                const names: string[] = []
                res.name?.forEach(n => {
                    names.push([
                        n.use ? n.use + ":" : "",
                        ...(n.prefix || []).join(", "),
                        ...(n.given || []),
                        n.family,
                        n.suffix
                    ].filter(Boolean).join(" "))
                })
                return names
            }
        },
        {
            "name": "telecom",
            "type": "token",
            "documentation": "The value in any kind of contact"
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: Practitioner) => res.id
        },
        {
            "name": "address-city",
            "type": "string",
            "documentation": "A city specified in an address",
            resolver     : (res: Practitioner) => {
                const out: string[] = []
                res.address?.forEach(x => {
                    if (x.city) {
                        out.push(x.city)
                    }
                })
                return out
            },
        },
        {
            "name": "family",
            "type": "string",
            "documentation": "A portion of the family name",
            resolver     : (res: Practitioner) => {
                return res.name?.map(x  => x.family).filter(Boolean)
            }
        },
        {
            "name": "email",
            "type": "token",
            "documentation": "A value in an email contact",
            resolver     : (res: Practitioner) => {
                const out = res.telecom?.filter(t => t.system === "email")
                    .map(x => x.value)
                    .filter(Boolean);
                return out && out.length ? out : undefined
            }
        }
    ]
}