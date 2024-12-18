import { CareTeam } from "fhir/r4";

export default {
    "type": "CareTeam",
    "profile": "http://hl7.org/fhir/StructureDefinition/CareTeam",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "date",
            "type": "date",
            "documentation": "Time period team covers",
            resolver: (res: CareTeam) => res.period
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "External Ids for this team"
        },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "Who care team is for",
            resolver: (res: CareTeam) => res.subject?.reference?.startsWith("Patient/") ? res.subject : undefined
        },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "Who care team is for"
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: CareTeam) => res.id
        },
        {
            "name": "encounter",
            "type": "reference",
            "documentation": "Encounter created as part of"
        },
        {
            "name": "category",
            "type": "token",
            "documentation": "Type of team"
        },
        {
            "name": "participant",
            "type": "reference",
            "documentation": "Who is involved",
            resolver: (res: CareTeam) => res.participant?.map(p => p.member)
        },
        {
            "name": "status",
            "type": "token",
            "documentation": "proposed | active | suspended | inactive | entered-in-error"
        }
    ]
}