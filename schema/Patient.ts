import { Patient } from "fhir/r4"
import config      from "../config"

export default {
    type: "Patient",
    operation: [
        {
            extension: [
                {
                    "url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation",
                    "valueCode": "SHOULD"
                }
            ],
            name: "export",
            definition: `${config.baseUrl}/fhir/OperationDefinition/PatientExport`
        }
    ],
    profile: "http://hl7.org/fhir/StructureDefinition/Patient",
    interaction: [
        {
            code: "read"
        }
    ],
    searchParam: [
        {
            name         : "birthdate",
            type         : "date",
            documentation: "The patient's date of birth",
            resolver     : (res: Patient) => res.birthDate
        },
        {
            name         : "deceased",
            type         : "token",
            documentation: "This patient has been marked as deceased, or as a death date entered",
            resolver     : (res: Patient) => res.deceasedDateTime || res.deceasedBoolean === true ? "true" : "false"
        },
        {
            name         : "address-state",
            type         : "string",
            documentation: "A state specified in an address",
            resolver     : (res: Patient) => {
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
            name         : "gender",
            type         : "token",
            documentation: "Gender of the patient"
        },
        {
            name         : "link",
            type         : "reference",
            documentation: "All patients linked to the given patient"
        },
        {
            name         : "language",
            type         : "token",
            documentation: "Language code (irrespective of use value)",
            resolver     : (res: Patient) => {
                const out = res.communication?.map(x  => x.language.coding).reduce(
                    (prev, cur) => {
                        if (Array.isArray(cur)) {
                            prev.push(...cur)
                        } else if (cur) {
                            prev.push(cur as any)
                        }
                        return prev
                    }, [] as any
                ).filter(Boolean)
                return out.length ? out : undefined
            },
        },
        {
            name         : "address-country",
            type         : "string",
            documentation: "A country specified in an address",
            resolver     : (res: Patient) => {
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
            name         : "death-date",
            type         : "date",
            documentation: "The date of death has been provided and satisfies this search value",
            resolver     : (res: Patient) => res.deceasedDateTime
        },
        {
            name         : "telecom",
            type         : "token",
            documentation: "The value in any kind of telecom details of the patient"
        },
        {
            name         : "address-city",
            type         : "string",
            documentation: "A city specified in an address",
            resolver     : (res: Patient) => {
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
            name         : "email",
            type         : "token",
            documentation: "A value in an email contact",
            resolver     : (res: Patient) => {
                const out = res.telecom?.filter(t => t.system === "email")
                    .map(x => x.value)
                    .filter(Boolean);
                return out && out.length ? out : undefined
            }
        },
        {
            name         : "given",
            type         : "string",
            documentation: "A portion of the given name of the patient",
            resolver     : (res: Patient) => {
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
            name         : "identifier",
            type         : "token",
            documentation: "A patient identifier"
        },
        {
            name         : "address",
            type         : "string",
            documentation: "A server defined search that may match any of the string fields in the Address, including line, city, district, state, country, postalCode, and/or text",
            resolver(res: Patient) {
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
            name         : "general-practitioner",
            type         : "reference",
            documentation: "Patient's nominated general practitioner, not the organization that manages the record",
            resolver     : (res: Patient) => res.generalPractitioner
        },
        {
            name         : "active",
            type         : "token",
            documentation: "Whether the patient record is active",
            resolver     : (res: Patient) => String(res.active !== false)
        },
        {
            name         : "address-postalcode",
            type         : "string",
            documentation: "A postalCode specified in an address",
            resolver     : (res: Patient) => {
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
            name         : "phone",
            type         : "token",
            documentation: "A value in a phone contact",
            resolver     : (res: Patient) => {
                const out = res.telecom?.filter(t => t.system === "phone")
                    .map(x => x.value)
                    .filter(Boolean);
                return out && out.length ? out : undefined
            }
        },
        {
            name         : "organization",
            type         : "reference",
            documentation: "The organization that is the custodian of the patient record",
            resolver     : (res: Patient) => res.managingOrganization
        },
        {
            name         : "address-use",
            type         : "token",
            documentation: "A use code specified in an address",
            resolver     : (res: Patient) => {
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
            name         : "name",
            type         : "string",
            documentation: "A server defined search that may match any of the string fields in the HumanName, including family, given, prefix, suffix, suffix, and/or text",
            resolver     : (res: Patient) => {
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
            name         : "_id",
            type         : "token",
            documentation: "The ID of the resource",
            resolver     : (res: Patient) => res.id
        },
        {
            name         : "family",
            type         : "string",
            documentation: "A portion of the family name of the patient",
            resolver     : (res: Patient) => {
                return res.name?.map(x  => x.family).filter(Boolean)
            }
        }
    ]
}