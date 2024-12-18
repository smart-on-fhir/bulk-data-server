import { Observation } from "fhir/r4";

export default {
    "type": "Observation",
    "profile": "http://hl7.org/fhir/StructureDefinition/Observation",
    "interaction": [
        {
            "code": "read"
        }
    ],
    searchParam: [
        {
            "name": "date",
            "type": "date",
            "documentation": "Obtained date/time. If the obtained element is a period, a date that falls in the period",
            resolver: (o: Observation) => o.effectivePeriod || o.effectiveDateTime
        },
        // {
        //     "name": "combo-data-absent-reason",
        //     "type": "token",
        //     "documentation": "The reason why the expected value in the element Observation.value[x] or Observation.component.value[x] is missing."
        // },
        // {
        //     "name": "code",
        //     "type": "token",
        //     "documentation": "The code of the observation type"
        // },
        // {
        //     "name": "combo-code-value-quantity",
        //     "type": "composite",
        //     "documentation": "Code and quantity value parameter pair, including in components"
        // },
        // {
        //     "name": "component-data-absent-reason",
        //     "type": "token",
        //     "documentation": "The reason why the expected value in the element Observation.component.value[x] is missing."
        // },
        {
            "name": "subject",
            "type": "reference",
            "documentation": "The subject that the observation is about"
        },
        // {
        //     "name": "value-concept",
        //     "type": "token",
        //     "documentation": "The value of the observation, if the value is a CodeableConcept"
        // },
        // {
        //     "name": "value-date",
        //     "type": "date",
        //     "documentation": "The value of the observation, if the value is a date or period of time"
        // },
        // {
        //     "name": "derived-from",
        //     "type": "reference",
        //     "documentation": "Related measurements the observation is made from"
        // },
        // {
        //     "name": "focus",
        //     "type": "reference",
        //     "documentation": "The focus of an observation when the focus is not the patient of record."
        // },
        // {
        //     "name": "part-of",
        //     "type": "reference",
        //     "documentation": "Part of referenced event"
        // },
        // {
        //     "name": "has-member",
        //     "type": "reference",
        //     "documentation": "Related resource that belongs to the Observation group"
        // },
        // {
        //     "name": "code-value-string",
        //     "type": "composite",
        //     "documentation": "Code and string value parameter pair"
        // },
        // {
        //     "name": "component-code-value-quantity",
        //     "type": "composite",
        //     "documentation": "Component code and component quantity value parameter pair"
        // },
        // {
        //     "name": "based-on",
        //     "type": "reference",
        //     "documentation": "Reference to the service request."
        // },
        // {
        //     "name": "code-value-date",
        //     "type": "composite",
        //     "documentation": "Code and date/time value parameter pair"
        // },
        {
            "name": "patient",
            "type": "reference",
            "documentation": "The subject that the observation is about (if patient)",
            resolver: (res: Observation) => { // Observation.subject.where(resolve() is Patient)
                return res.subject?.reference?.startsWith("Patient/") ? res.subject : undefined
            }
        },
        // {
        //     "name": "specimen",
        //     "type": "reference",
        //     "documentation": "Specimen used for this observation"
        // },
        // {
        //     "name": "code-value-quantity",
        //     "type": "composite",
        //     "documentation": "Code and quantity value parameter pair"
        // },
        // {
        //     "name": "component-code",
        //     "type": "token",
        //     "documentation": "The component code of the observation type"
        // },
        // {
        //     "name": "combo-code-value-concept",
        //     "type": "composite",
        //     "documentation": "Code and coded value parameter pair, including in components"
        // },
        // {
        //     "name": "value-string",
        //     "type": "string",
        //     "documentation": "The value of the observation, if the value is a string, and also searches in CodeableConcept.text"
        // },
        // {
        //     "name": "identifier",
        //     "type": "token",
        //     "documentation": "The unique id for a particular observation"
        // },
        // {
        //     "name": "performer",
        //     "type": "reference",
        //     "documentation": "Who performed the observation"
        // },
        // {
        //     "name": "combo-code",
        //     "type": "token",
        //     "documentation": "The code of the observation type or component type"
        // },
        // {
        //     "name": "method",
        //     "type": "token",
        //     "documentation": "The method used for the observation"
        // },
        // {
        //     "name": "value-quantity",
        //     "type": "quantity",
        //     "documentation": "The value of the observation, if the value is a Quantity, or a SampledData (just search on the bounds of the values in sampled data)"
        // },
        // {
        //     "name": "component-value-quantity",
        //     "type": "quantity",
        //     "documentation": "The value of the component observation, if the value is a Quantity, or a SampledData (just search on the bounds of the values in sampled data)"
        // },
        // {
        //     "name": "data-absent-reason",
        //     "type": "token",
        //     "documentation": "The reason why the expected value in the element Observation.value[x] is missing."
        // },
        // {
        //     "name": "combo-value-quantity",
        //     "type": "quantity",
        //     "documentation": "The value or component value of the observation, if the value is a Quantity, or a SampledData (just search on the bounds of the values in sampled data)"
        // },
        {
            "name": "encounter",
            "type": "reference",
            "documentation": "Encounter related to the observation"
        },
        // {
        //     "name": "code-value-concept",
        //     "type": "composite",
        //     "documentation": "Code and coded value parameter pair"
        // },
        // {
        //     "name": "component-code-value-concept",
        //     "type": "composite",
        //     "documentation": "Component code and component coded value parameter pair"
        // },
        {
            "name": "_id",
            "type": "token",
            "documentation": "The ID of the resource",
            resolver: (res: Observation) => res.id
        },
        // {
        //     "name": "component-value-concept",
        //     "type": "token",
        //     "documentation": "The value of the component observation, if the value is a CodeableConcept"
        // },
        {
            "name": "category",
            "type": "token",
            "documentation": "The classification of the type of observation",
            resolver: (res: Observation) => {
                const out: any[] = []
                res.category?.forEach(x => {
                    if (x.coding) {
                        out.push(...x.coding)
                    }
                })
                return out
            }
        },
        {
            "name": "device",
            "type": "reference",
            "documentation": "The Device that generated the observation data."
        },
        // {
        //     "name": "combo-value-concept",
        //     "type": "token",
        //     "documentation": "The value or component value of the observation, if the value is a CodeableConcept"
        // },
        {
            "name": "status",
            "type": "token",
            "documentation": "The status of the observation"
        }
    ]
}