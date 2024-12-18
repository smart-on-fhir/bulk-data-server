import { Condition } from "fhir/r4";

export default {
    "type": "Condition",
    "profile": "http://hl7.org/fhir/StructureDefinition/Condition",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "evidence-detail",
            "type": "reference",
            "documentation": "Supporting information found elsewhere",
            resolver: (res: Condition) => {
                const out: any[] = []
                res.evidence?.forEach(x => {
                    if (x.detail) {
                        out.push(...x.detail)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "severity",
            "type": "token",
            "documentation": "The severity of the condition"
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "A unique identifier of the condition record"
        },
        {
            "name": "onset-info",
            "type": "string",
            "documentation": "Onsets as a string",
            resolver: (res: Condition) => res.onsetString
        },
        {
            "name": "recorded-date",
            "type": "date",
            "documentation": "Date record was first recorded",
            resolver: (res: Condition) => res.recordedDate
        },
        {
            "name": "code",
            "type": "token",
            "documentation": "Code for the condition",
            resolver: (res: Condition) => res.code?.coding
        },
        {
            "name": "evidence",
            "type": "token",
            "documentation": "Manifestation/symptom",
            resolver: (res: Condition) => {
                const out: any[] = []
                res.evidence?.forEach(x => {
                    if (x.code) {
                        out.push(...x.code)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "Who has the condition?"
        },
        {
            "name": "verification-status",
            "type": "token",
            "documentation": "unconfirmed | provisional | differential | confirmed | refuted | entered-in-error",
            resolver: (res: Condition) => res.verificationStatus?.coding
        },
        {
            "name": "clinical-status",
            "type": "token",
            "documentation": "The clinical status of the condition",
            resolver: (res: Condition) => res.clinicalStatus?.coding
        },
        {
            "name": "encounter",
            "type": "reference",
            "documentation": "Encounter created as part of"
        },
        {
            "name": "onset-date",
            "type": "date",
            "documentation": "Date related onsets (dateTime and Period)",
            resolver: (res: Condition) => res.onsetPeriod || res.onsetDateTime
        },
        {
            "name": "abatement-date",
            "type": "date",
            "documentation": "Date-related abatements (dateTime and period)",
            resolver: (res: Condition) => res.abatementDateTime || res.abatementPeriod
        },
        {
            "name": "asserter",
            "type": "reference",
            "documentation": "Person who asserts this condition"
        },
        {
            "name": "stage",
            "type": "token",
            "documentation": "Simple summary (disease specific)",
            resolver: (res: Condition) => res.stage?.map(x => x.summary)
        },
        {
            "name": "abatement-string",
            "type": "string",
            "documentation": "Abatement as a string",
            resolver: (res: Condition) => res.abatementString
        },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "Who has the condition?",
            resolver: (res: Condition) => res.subject?.reference?.startsWith("Patient/") ? res.subject : undefined
        },
        {
            "name": "abatement-age",
            "type": "quantity",
            "documentation": "Abatement as age or age range",
            resolver: (res: Condition) => res.abatementAge || res.abatementRange
        },
        {
            "name": "onset-age",
            "type": "quantity",
            "documentation": "Onsets as age or age range",
            resolver: (res: Condition) => res.onsetAge || res.onsetRange
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: Condition) => res.id
        },
        {
            "name": "body-site",
            "type": "token",
            "documentation": "Anatomical location, if relevant",
            resolver: (res: Condition) => res.bodySite
        },
        {
            "name": "category",
            "type": "token",
            "documentation": "The category of the condition",
            resolver: (res: Condition) => {
                const out: any[] = []
                res.category?.forEach(x => {
                    if (x.coding) {
                        out.push(...x.coding.map(c => c.code))
                    }
                })
                return out.length ? out : undefined
            }
        }
    ]
}