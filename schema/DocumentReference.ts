import { DocumentReference } from "fhir/r4";

export default {
    "type": "DocumentReference",
    "profile": "http://hl7.org/fhir/StructureDefinition/DocumentReference",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "date",
            "type": "date",
            "documentation": "When this document reference was created"
        },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "Who/what is the subject of the document"
        },
        {
            "name": "description",
            "type": "string",
            "documentation": "Human-readable description"
        },
        {
            "name": "language",
            "type": "token",
            "documentation": "Human language of the content (BCP-47)",
            resolver: (res: DocumentReference) => {
                const out: any[] = []
                res.content?.forEach(x => {
                    if (x.attachment.language) {
                        out.push(x.attachment.language)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "type",
            "type": "token",
            "documentation": "Kind of document (LOINC if possible)",
            resolver: (res: DocumentReference) => res.type?.coding
        },
        {
            "name": "relation",
            "type": "token",
            "documentation": "replaces | transforms | signs | appends",
            resolver: (res: DocumentReference) => res.relatesTo?.map(x => x.code)
        },
        {
            "name": "setting",
            "type": "token",
            "documentation": "Additional details about where the content was created (e.g. clinical specialty)",
            resolver: (res: DocumentReference) => res.context?.practiceSetting?.coding?.map(x => x.code)
        },
        {
            "name": "related",
            "type": "reference",
            "documentation": "Related identifiers or resources",
            resolver: (res: DocumentReference) => res.context?.related
        },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "Who/what is the subject of the document",
            resolver: (res: DocumentReference) => res.subject?.reference?.startsWith("Patient/") ? res.subject : undefined
        },
        {
            "name": "event",
            "type": "token",
            "documentation": "Main clinical acts documented",
            resolver: (res: DocumentReference) => res.context?.event?.map(x => x.coding)
        },
        {
            "name": "authenticator",
            "type": "reference",
            "documentation": "Who/what authenticated the document"
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "Master Version Specific Identifier",
            resolver: (res: DocumentReference) => res.masterIdentifier || res.identifier
        },
        {
            "name": "period",
            "type": "date",
            "documentation": "Time of service that is being documented",
            resolver: (res: DocumentReference) => res.context?.period
        },
        {
            "name": "custodian",
            "type": "reference",
            "documentation": "Organization which maintains the document"
        },
        {
            "name": "author",
            "type": "reference",
            "documentation": "Who and/or what authored the document"
        },
        {
            "name": "format",
            "type": "token",
            "documentation": "Format/content rules for the document",
            resolver: (res: DocumentReference) => {
                const out: any[] = []
                res.content?.forEach(x => {
                    if (x.format) {
                        out.push(x.format)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "encounter",
            "type": "reference",
            "documentation": "Context of the document  content",
            resolver: (res: DocumentReference) => res.context?.encounter?.filter(x => x.reference?.startsWith("Encounter/"))
        },
        {
            "name": "contenttype",
            "type": "token",
            "documentation": "Mime type of the content, with charset etc.",
            resolver: (res: DocumentReference) => res.content?.map(x => x.attachment.contentType)
        },
        {
            "name": "security-label",
            "type": "token",
            "documentation": "Document security-tags",
            resolver: (res: DocumentReference) => res.securityLabel?.map(x => x.coding)
        },
        {
            "name": "location",
            "type": "uri",
            "documentation": "Uri where the data can be found",
            resolver: (res: DocumentReference) => {
                const out: any[] = []
                res.content?.forEach(x => {
                    if (x.attachment.url) {
                        out.push(x.attachment.url)
                    }
                })
                return out.length ? out : undefined
            }
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: DocumentReference) => res.id
        },
        {
            "name": "category",
            "type": "token",
            "documentation": "Categorization of document",
            resolver: (res: DocumentReference) => res.category?.map(x => x.coding)
        },
        {
            "name": "relatesto",
            "type": "reference",
            "documentation": "Target of the relationship",
            resolver: (res: DocumentReference) => res.relatesTo?.map(x => x.target)
        },
        {
            "name": "facility",
            "type": "token",
            "documentation": "Kind of facility where patient was seen",
            resolver: (res: DocumentReference) => res.context?.facilityType?.coding
        },
        {
            "name": "status",
            "type": "token",
            "documentation": "current | superseded | entered-in-error"
        }
    ]
}