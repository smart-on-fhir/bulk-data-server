import { Encounter } from "fhir/r4"

export default {
    "type": "Encounter",
    "profile": "http://hl7.org/fhir/StructureDefinition/Encounter",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "date",
            "type": "date",
            "documentation": "A date within the period the Encounter lasted",
            resolver: (res: Encounter) => res.period
        },
        // {
        //   "name": "participant-type",
        //   "type": "token",
        //   "documentation": "Role of participant in encounter"
        // },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "The patient or group present at the encounter"
        },
        {
            "name": "appointment",
            "type": "reference",
            "documentation": "The appointment that scheduled this encounter"
        },
        // {
        //   "name": "part-of",
        //   "type": "reference",
        //   "documentation": "Another Encounter this encounter is part of"
        // },
        {
            "name": "type",
            "type": "token",
            "documentation": "Specific type of encounter",
            resolver: (res: Encounter) => {
                const out: any[] = []
                res.type?.forEach(x => {
                    if (x.coding) {
                        out.push(...x.coding)
                    }
                })
                return out
            }
        },
        {
            "name": "participant",
            "type": "reference",
            "documentation": "Persons involved in the encounter other than the patient",
            resolver: (res: Encounter) => {
                const out: any[] = []
                res.participant?.forEach(x => {
                    if (x.individual) {
                        out.push(x.individual)
                    }
                })
                return out
            }
        },
        {
            "name": "reason-code",
            "type": "token",
            "documentation": "Coded reason the encounter takes place",
            resolver: (res: Encounter) => {
                const out: any[] = []
                res.reasonCode?.forEach(x => {
                    if (x.coding) {
                        out.push(...x.coding)
                    }
                })
                return out
            }
        },
        // {
        //   "name": "based-on",
        //   "type": "reference",
        //   "documentation": "The ServiceRequest that initiated this encounter"
        // },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "The patient or group present at the encounter",
            resolver: (res: Encounter) => {
                return res.subject?.reference?.startsWith("Patient/") ?
                    res.subject :
                    undefined
            }
        },
        // {
        //   "name": "location-period",
        //   "type": "date",
        //   "documentation": "Time period during which the patient was present at the location"
        // },
        // {
        //   "name": "special-arrangement",
        //   "type": "token",
        //   "documentation": "Wheelchair, translator, stretcher, etc."
        // },
        {
            "name": "class",
            "type": "token",
            "documentation": "Classification of patient encounter"
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "Identifier(s) by which this encounter is known"
        },
        {
            "name": "practitioner",
            "type": "reference",
            "documentation": "Persons involved in the encounter other than the patient",
            resolver: (res: Encounter) => {
                const out: any[] = []
                res.participant?.forEach(x => {
                    if (x.individual?.reference?.startsWith("Practitioner/")) {
                        out.push(x.individual)
                    }
                })
                return out
            }
        },
        // {
        //   "name": "episode-of-care",
        //   "type": "reference",
        //   "documentation": "Episode(s) of care that this encounter should be recorded against"
        // },
        {
            "name": "length",
            "type": "quantity",
            "documentation": "Length of encounter in days"
        },
        {
            "name": "diagnosis",
            "type": "reference",
            "documentation": "The diagnosis or procedure relevant to the encounter",
            resolver: (res: Encounter) => res.diagnosis?.map(d => d.condition)
        },
        {
            "name": "reason-reference",
            "type": "reference",
            "documentation": "Reason the encounter takes place (reference)",
            resolver: (res: Encounter) => res.reasonReference
        },
        {
            "name": "location",
            "type": "reference",
            "documentation": "Location the encounter takes place",
            resolver: (res: Encounter) => {
                const out: any[] = []
                res.location?.forEach(x => {
                    if (x.location) {
                        out.push(x.location)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "service-provider",
            "type": "reference",
            "documentation": "The organization (facility) responsible for this encounter",
            resolver: (res: Encounter) => res.serviceProvider
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: Encounter) => res.id
        },
        {
            "name": "account",
            "type": "reference",
            "documentation": "The set of accounts that may be used for billing for this Encounter"
        },
        {
            "name": "status",
            "type": "token",
            "documentation": "planned | in-progress | on-hold | completed | cancelled | entered-in-error | unknown"
        }
    ]
}
