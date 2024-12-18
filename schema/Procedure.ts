import { Procedure } from "fhir/r4";

export default {
    "type": "Procedure",
    "profile": "http://hl7.org/fhir/StructureDefinition/Procedure",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "date",
            "type": "date",
            "documentation": "When the procedure was performed",
            resolver: (res: Procedure) => res.performedPeriod || res.performedDateTime
        },
        {
            "name": "code",
            "type": "token",
            "documentation": "A code to identify a  procedure",
            resolver: (res: Procedure) => res.code?.coding
        },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "Search by subject"
        },
        {
            "name": "encounter",
            "type": "reference",
            "documentation": "Encounter created as part of"
        },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "Search by subject - a patient",
            resolver: (res: Procedure) => { // Procedure.subject.where(resolve() is Patient)
                return res.subject.reference?.startsWith("Patient/") ? res.subject : undefined
            }
        },
        {
            "name": "reason-reference",
            "type": "reference",
            "documentation": "The justification that the procedure was performed",
            resolver: (res: Procedure) => res.reasonReference
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: Procedure) => res.id
        },
        {
            "name": "status",
            "type": "token",
            "documentation": "preparation | in-progress | not-done | suspended | aborted | completed | entered-in-error | unknown"
        }
    ]
}