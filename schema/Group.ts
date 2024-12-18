import { Group } from "fhir/r4";


export default {
    type: "Group",
    profile: "http://hl7.org/fhir/StructureDefinition/Group",
    interaction: [
        {
            "code": "read"
        },
        // {
        //     "code": "update"
        // },
        // {
        //     "code": "patch"
        // },
        // {
        //     "code": "delete"
        // },
        // {
        //     "code": "create"
        // }
    ],
    searchParam: [
        {
            "name": "actual",
            "type": "token",
            "documentation": "Descriptive or actual",
            resolver: (res: Group) => res.actual ? "true" : "false"
        },
        {
            "name": "member",
            "type": "reference",
            "documentation": "Reference to the group member",
            resolver: (res: Group) => res.member?.map(m => m.entity)
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: Group) => res.id
        },
        {
            "name": "type",
            "type": "token",
            "documentation": "The type of resources the group contains"
        }
    ]
}