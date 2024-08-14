import { Request, Response } from "express";
import moment                from "moment"
import config                from "../config"
import { replyWithError }    from "../lib"
import pkg                   from "../package.json"
import { RequestWithSim }    from "../types";

const SERVER_START_TIME = moment().format("YYYY-MM-DDTHH:mm:ssZ");

const SUPPORTED_FORMATS = [
    "application/fhir+json",
    "application/json+fhir",
    "application/json",
    "text/json",
    "json"
];

const SUPPORTED_ACCEPT_MIME_TYPES = [
    "application/fhir+json",
    "application/json+fhir",
    "application/json",
    "text/json",
    "text/html", // for browsers
    "json",
    "*/*"
];

const FHIR_VERSION_TO_CONTENT_TYPE = {
    4: "application/fhir+json; charset=utf-8",
    3: "application/json+fhir; charset=utf-8",
    2: "application/json; charset=utf-8"
};

function getFhirVersion(stu: number): string {
    switch (+stu) {
        case 2:
            return "1.0.2";
        case 3:
            return "3.0.2";
        default:
            return "4.0.1";
    }
}

class CapabilityStatement
{
    /**
     * Numeric FHIR version
     */
    private stu: number;

    constructor(stu = 4)
    {
        this.stu = +stu;
    }

    getResources()
    {
        /**
         * Array of supported resources to be listed in the CapabilityStatement
         * @type {*[]}
         */
        const resources = [
            {
                "type": "Patient",
                "operation": [
                    {
                        "extension": [
                            {
                                "url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation",
                                "valueCode": "SHOULD"
                            }
                        ],
                        "name": "export",
                        "definition": this.stu === 4 ?
                            "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/patient-export" :
                            { reference: "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/patient-export" }
                    }
                ]
            },
            {
                "type": "Group",
                "operation": [
                    {
                        "extension": [
                            {
                                "url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation",
                                "valueCode": "SHOULD"
                            }
                        ],
                        "name": "export",
                        "definition": this.stu === 4 ?
                            "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/group-export" :
                            { reference: "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/group-export" }
                    }
                ]
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
                "searchParam": []
            }
        ];

        return resources;
    }

    getOperations()
    {
        return [
            {
                "name": "get-resource-counts",
                "definition": this.stu === 4 ?
                    "OperationDefinition/-s-get-resource-counts" :
                    { reference: "OperationDefinition/-s-get-resource-counts" }
            },
            {
                "extension": [
                  {
                    "url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation",
                    "valueCode": "SHOULD"
                  }
                ],
                "name": "export",
                "definition": this.stu === 4 ?
                    "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export" :
                    { reference: "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export" }
            }
        ];
    }

    toJSON()
    {
        return {
            resourceType: "CapabilityStatement",
            status: "active",
            date: SERVER_START_TIME,
            publisher: "Boston Children's Hospital",
            kind: "instance",
            instantiates: [
                "http://hl7.org/fhir/uv/bulkdata/CapabilityStatement/bulk-data"
            ],
            software: {
                name: "SMART Sample Bulk Data Server",
                version: pkg.version
            },
            implementation: {
                "description": "SMART Sample Bulk Data Server"
            },
            fhirVersion: getFhirVersion(this.stu),
            acceptUnknown: "extensions",
            format: [ "json" ],
            rest: [
                {
                    mode: "server",
                    security: {
                        extension: [
                            {
                                url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
                                extension: [
                                    {
                                        url: "token",
                                        valueUri: `${config.baseUrl}/auth/token`
                                    },
                                    {
                                        url: "register",
                                        valueUri: `${config.baseUrl}/auth/register`
                                    }
                                ]
                            }
                        ],
                        service: [
                            {
                                coding: [
                                    {
                                        system : "http://hl7.org/fhir/restful-security-service",
                                        code   : "SMART-on-FHIR",
                                        display: "SMART-on-FHIR"
                                    }
                                ],
                                text: "OAuth2 using SMART-on-FHIR profile (see http://docs.smarthealthit.org)"
                            }
                        ]
                    },
                    resource: this.getResources(),
                    operation: this.getOperations()
                }
            ]
        }
    }
}

export default function(req: Request, res: Response) {
    const stu = (req as RequestWithSim).sim.stu || 4
    const { query } = req

    if (query._format) {
        let format = String(query._format).toLowerCase();
        if (!SUPPORTED_FORMATS.some(mime => format.indexOf(mime) === 0)) {
            return replyWithError(res, "only_json_supported", 400);
        }
    }

    const accept = String(req.headers.accept || "*/*").toLowerCase().split(/\s*[;,]\s*/).shift();
    if (!SUPPORTED_ACCEPT_MIME_TYPES.some(f => f === accept)) {
        return replyWithError(res, "only_json_supported", 400);
    }

    const statement = new CapabilityStatement(stu);

    const key = stu as keyof typeof FHIR_VERSION_TO_CONTENT_TYPE
    res.set("content-type", FHIR_VERSION_TO_CONTENT_TYPE[key]).send(JSON.stringify(statement.toJSON(), null, 4));
}
