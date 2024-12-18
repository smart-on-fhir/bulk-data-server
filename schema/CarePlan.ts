import { CarePlan } from "fhir/r4";

export default {
    "type": "CarePlan",
    "profile": "http://hl7.org/fhir/StructureDefinition/CarePlan",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "activity-code",
            "type": "token",
            "documentation": "Detail type of activity",
            resolver: (res: CarePlan) => {
                const out: any[] = []
                res.activity?.forEach(x => {
                    if (x.detail?.code?.coding) {
                        out.push(...x.detail.code.coding)
                    }
                })
                return out
            }
        },
        {
            "name": "activity-date",
            "type": "date",
            "documentation": "Specified date occurs within period specified by CarePlan.activity.detail.scheduled[x]",
            resolver: (res: CarePlan) => {
                const out: any[] = []
                res.activity?.forEach(x => {
                    if (x.detail?.scheduledPeriod) {
                        out.push(x.detail.scheduledPeriod)
                    }
                })
                return out
            }
        },
        {
            "name": "activity-reference",
            "type": "reference",
            "documentation": "Activity details defined in specific resource",
            resolver: (res: CarePlan) => {
                const out: any[] = []
                res.activity?.forEach(x => {
                    if (x.reference) {
                        out.push(x.reference)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "care-team",
            "type": "reference",
            "documentation": "Who's involved in plan?",
            resolver: (res: CarePlan) => res.careTeam
        },
        {
            "name": "date",
            "type": "date",
            "documentation": "Time period plan covers",
            resolver: (res: CarePlan) => res.period
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "External Ids for this plan"
        },
        {
            "name": "goal",
            "type": "reference",
            "documentation": "Desired outcome of plan"
        },
        {
            "name": "performer",
            "type": "reference",
            "documentation": "Matches if the practitioner is listed as a performer in any of the \"simple\" activities.  (For performers of the detailed activities, chain through the activitydetail search parameter.)",
            resolver: (res: CarePlan) => {
                const out: any[] = []
                res.activity?.forEach(x => {
                    if (x.detail?.performer) {
                        out.push(...x.detail.performer)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "replaces",
            "type": "reference",
            "documentation": "CarePlan replaced by this CarePlan"
        },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "Who the care plan is for"
        },
        {
            "name": "instantiates-canonical",
            "type": "reference",
            "documentation": "Instantiates FHIR protocol or definition",
            resolver: (res: CarePlan) => res.instantiatesCanonical
        },
        {
            "name": "part-of",
            "type": "reference",
            "documentation": "Part of referenced CarePlan",
            resolver: (res: CarePlan) => res.partOf
        },
        {
            "name": "encounter",
            "type": "reference",
            "documentation": "Encounter created as part of"
        },
        {
            "name": "intent",
            "type": "token",
            "documentation": "proposal | plan | order | option"
        },
        {
            "name": "condition",
            "type": "reference",
            "documentation": "Health issues this plan addresses",
            resolver: (res: CarePlan) => res.addresses
        },
        {
            "name": "based-on",
            "type": "reference",
            "documentation": "Fulfills CarePlan",
            resolver: (res: CarePlan) => res.basedOn
        },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "Who the care plan is for",
            resolver: (res: CarePlan) => res.subject?.reference?.startsWith("Patient/") ? res.subject : undefined
        },
        {
            "name": "instantiates-uri",
            "type": "uri",
            "documentation": "Instantiates external protocol or definition",
            resolver: (res: CarePlan) => res.instantiatesUri
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: CarePlan) => res.id
        },
        {
            "name": "category",
            "type": "token",
            "documentation": "Type of plan",
            resolver: (res: CarePlan) => {
                const out: any[] = []
                res.category?.forEach(x => {
                    if (x.coding) {
                        out.push(...x.coding)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "status",
            "type": "token",
            "documentation": "draft | active | suspended | completed | entered-in-error | cancelled | unknown"
        }
    ]
}