const crypto = require("crypto");
const moment = require("moment");
const config = require("../config");

const SERVER_START_TIME = moment().format("YYYY-MM-DD HH:mm:ss");


module.exports = (req, res) => res.json({
    "resourceType": "CapabilityStatement",
    "status": "active",
    "date": SERVER_START_TIME,
    "publisher": "Not provided",
    "kind": "instance",
    "software": {
        "name": "SMART Sample Bulk FHIR Server",
        "version": "1.0"
    },
    "implementation": {
        "description": "SMART Sample Bulk FHIR Server"
    },
    "fhirVersion": "3.0.1",
    "acceptUnknown": "extensions",
    "format": [
        "application/fhir+json"
    ],
    "rest": [
        {
            "mode": "server",
            "security": {
                "extension": [
                    {
                        "url": "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
                        "extension": [
                            {
                                "url": "token",
                                "valueUri": `${config.baseUrl}/auth/token`
                            },
                            {
                                "url": "register",
                                "valueUri": `${config.baseUrl}/auth/register`
                            }
                        ]
                    }
                ],
                "service": [
                    {
                        "coding": [
                            {
                                "system": "http://hl7.org/fhir/restful-security-service",
                                "code": "SMART-on-FHIR",
                                "display": "SMART-on-FHIR"
                            }
                        ],
                        "text": "OAuth2 using SMART-on-FHIR profile (see http://docs.smarthealthit.org)"
                    }
                ]
            },
            "resource": [
                {
                    "type": "Group",
                    "profile": {
                        "reference": "http://hl7.org/fhir/Profile/Group"
                    },
                    "interaction": [
                        {
                            "code": "read"
                        }
                    ],
                    // "versioning": "versioned-update",
                    // "conditionalCreate": true,
                    // "conditionalUpdate": true,
                    // "conditionalDelete": "multiple",
                    // "searchInclude": [
                    //     "*",
                    //     "Group:member"
                    // ],
                    "searchParam": []
                },
                {
                    "type": "OperationDefinition",
                    "profile": {
                        "reference": "http://hl7.org/fhir/Profile/OperationDefinition"
                    },
                    "interaction": [
                        {
                            "code": "read"
                        }
                    ],
                    // "versioning": "versioned-update",
                    // "conditionalCreate": true,
                    // "conditionalUpdate": true,
                    // "conditionalDelete": "multiple",
                    // "searchInclude": [
                    //     "*",
                    //     "Group:member"
                    // ],
                    "searchParam": []
                }
            ],
            // "interaction": [
            //     {
            //         "code": "history-system"
            //     },
            //     {
            //         "code": "transaction"
            //     }
            // ],
            "operation": [
                {
                    "name": "everything",
                    "definition": {
                        "reference": "OperationDefinition/Patient--everything"
                    }
                },
                {
                    "name": "everything",
                    "definition": {
                        "reference": "OperationDefinition/Group-i-everything"
                    }
                },
                {
                    "name": "get-resource-counts",
                    "definition": {
                        "reference": "OperationDefinition/-s-get-resource-counts"
                    }
                }
            ]
        }
    ]
});
