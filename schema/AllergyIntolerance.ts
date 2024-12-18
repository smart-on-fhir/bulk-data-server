import { AllergyIntolerance } from "fhir/r4";

export default {
    "type": "AllergyIntolerance",
    "profile": "http://hl7.org/fhir/StructureDefinition/AllergyIntolerance",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "date",
            "type": "date",
            "documentation": "Date first version of the resource instance was recorded",
            resolver: (res: AllergyIntolerance) => res.recordedDate
        },
        {
            "name": "severity",
            "type": "token",
            "documentation": "mild | moderate | severe (of event as a whole)",
            resolver: (res: AllergyIntolerance) => res.reaction?.map(r => r.severity)
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "External ids for this item"
        },
        {
            "name": "manifestation",
            "type": "token",
            "documentation": "Clinical symptoms/signs associated with the Event",
            resolver: (res: AllergyIntolerance) => res.reaction?.map(r => r.manifestation)
        },
        {
            "name": "recorder",
            "type": "reference",
            "documentation": "Who recorded the sensitivity"
        },
        {
            "name": "code",
            "type": "token",
            "documentation": "Code that identifies the allergy or intolerance",
            resolver: (res: AllergyIntolerance) => res.code?.coding || res.reaction?.map(r => r.substance)
        },
        {
            "name": "verification-status",
            "type": "token",
            "documentation": "unconfirmed | confirmed | refuted | entered-in-error",
            resolver: (res: AllergyIntolerance) => res.verificationStatus?.coding
        },
        {
            "name": "criticality",
            "type": "token",
            "documentation": "low | high | unable-to-assess"
        },
        {
            "name": "clinical-status",
            "type": "token",
            "documentation": "active | inactive | resolved",
            resolver: (res: AllergyIntolerance) => res.clinicalStatus?.coding
        },
        {
            "name": "onset",
            "type": "date",
            "documentation": "Date(/time) when manifestations showed",
            resolver: (res: AllergyIntolerance) => res.reaction?.map(r => r.onset)
        },
        {
            "name": "type",
            "type": "token",
            "documentation": "allergy | intolerance - Underlying mechanism (if known)"
        },
        {
            "name": "route",
            "type": "token",
            "documentation": "How the subject was exposed to the substance",
            resolver: (res: AllergyIntolerance) => res.reaction?.map(r => r.exposureRoute)
        },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "Who the sensitivity is for"
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: AllergyIntolerance) => res.id
        },
        {
            "name": "category",
            "type": "token",
            "documentation": "food | medication | environment | biologic"
        },
        {
            "name": "last-date",
            "type": "date",
            "documentation": "Date(/time) of last known occurrence of a reaction",
            resolver: (res: AllergyIntolerance) => res.lastOccurrence
        }
    ]
}