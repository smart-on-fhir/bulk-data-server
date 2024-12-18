import { DiagnosticReport } from "fhir/r4";

export default {
    "type": "DiagnosticReport",
    "profile": "http://hl7.org/fhir/StructureDefinition/DiagnosticReport",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "date",
            "type": "date",
            "documentation": "The clinically relevant time of the report",
            resolver: (res: DiagnosticReport) => res.effectivePeriod || res.effectiveDateTime
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "An identifier for the report"
        },
        {
            "name": "code",
            "type": "token",
            "documentation": "The code for the report, as opposed to codes for the atomic results, which are the names on the observation resource referred to from the result",
            resolver: (res: DiagnosticReport) => res.code?.coding
        },
        {
            "name": "performer",
            "type": "reference",
            "documentation": "Who is responsible for the report"
        },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "The subject of the report"
        },
        {
            "name": "encounter",
            "type": "reference",
            "documentation": "The Encounter when the order was made"
        },
        {
            "name": "media",
            "type": "reference",
            "documentation": "A reference to the image source.",
            resolver: (res: DiagnosticReport) => res.media?.map(x => x.link)
        },
        {
            "name": "conclusion",
            "type": "token",
            "documentation": "A coded conclusion (interpretation/impression) on the report",
            resolver: (res: DiagnosticReport) => res.conclusionCode?.map(x => x.coding)
        },
        {
            "name": "result",
            "type": "reference",
            "documentation": "Link to an atomic result (observation resource)"
        },
        {
            "name": "based-on",
            "type": "reference",
            "documentation": "Reference to the service request.",
            resolver: (res: DiagnosticReport) => res.basedOn
        },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "The subject of the report if a patient",
            resolver: (res: DiagnosticReport) => res.subject?.reference?.startsWith("Patient/") ? res.subject : undefined
        },
        {
            "name": "specimen",
            "type": "reference",
            "documentation": "The specimen details"
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: DiagnosticReport) => res.id
        },
        {
            "name": "category",
            "type": "token",
            "documentation": "Which diagnostic discipline/department created the report",
            resolver: (res: DiagnosticReport) => {
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
            "name": "issued",
            "type": "date",
            "documentation": "When the report was issued"
        },
        {
            "name": "results-interpreter",
            "type": "reference",
            "documentation": "Who was the source of the report",
            resolver: (res: DiagnosticReport) => res.resultsInterpreter
        },
        {
            "name": "status",
            "type": "token",
            "documentation": "The status of the report"
        }
    ]
}