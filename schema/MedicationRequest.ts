import { MedicationRequest } from "fhir/r4";

export default {
    "type": "MedicationRequest",
    "profile": "http://hl7.org/fhir/StructureDefinition/MedicationRequest",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "date",
            "type": "date",
            "documentation": "Returns medication request to be administered on a specific date",
            resolver: (res: MedicationRequest) => res.dosageInstruction?.map(x => x.timing?.event)
        },
        {
            "name": "requester",
            "type": "reference",
            "documentation": "Returns prescriptions prescribed by this prescriber"
        },
        {
            "name": "identifier",
            "type": "token",
            "documentation": "Return prescriptions with this external identifier"
        },
        {
            "name": "intended-dispenser",
            "type": "reference",
            "documentation": "Returns prescriptions intended to be dispensed by this Organization",
            resolver: (res: MedicationRequest) => res.dispenseRequest?.performer
        },
        {
            "name": "authoredon",
            "type": "date",
            "documentation": "Return prescriptions written on this date",
            resolver: (res: MedicationRequest) => res.authoredOn
        },
        {
            "name": "code",
            "type": "token",
            "documentation": "Return prescriptions of this medication code",
            resolver: (res: MedicationRequest) => res.medicationCodeableConcept?.coding
        },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "The identity of a patient to list orders  for"
        },
        {
            "name": "medication",
            "type": "reference",
            "documentation": "Return prescriptions for this medication reference",
            resolver: (res: MedicationRequest) => res.medicationReference
        },
        {
            "name": "encounter",
            "type": "reference",
            "documentation": "Return prescriptions with this encounter identifier"
        },
        {
            "name": "priority",
            "type": "token",
            "documentation": "Returns prescriptions with different priorities"
        },
        {
            "name": "intent",
            "type": "token",
            "documentation": "Returns prescriptions with different intents"
        },
        {
            "name": "intended-performer",
            "type": "reference",
            "documentation": "Returns the intended performer of the administration of the medication request",
            resolver: (res: MedicationRequest) => res.performer
        },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "Returns prescriptions for a specific patient",
            resolver: (res: MedicationRequest) => res.subject?.reference?.startsWith("Patient/") ? res.subject : undefined
        },
        {
            "name": "intended-performertype",
            "type": "token",
            "documentation": "Returns requests for a specific type of performer",
            resolver: (res: MedicationRequest) => res.performerType?.coding
        },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: MedicationRequest) => res.id
        },
        {
            "name": "category",
            "type": "token",
            "documentation": "Returns prescriptions with different categories",
            resolver: (res: MedicationRequest) => res.category?.map(x => x.coding)
        },
        {
            "name": "status",
            "type": "token",
            "documentation": "Status of the prescription"
        }
    ]
}