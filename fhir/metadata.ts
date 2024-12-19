import { Request, Response }               from "express"
import moment                              from "moment"
import { CapabilityStatementRestResource } from "fhir/r4"
import pkg                                 from "../package.json"
import config                              from "../config"
import { replyWithError }                  from "../lib"
import schema                              from "../schema"

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

function getCapabilityStatementRestResource(schema: any): CapabilityStatementRestResource {
    const out = { ...schema as CapabilityStatementRestResource }
    out.searchParam = (out.searchParam || []).map(p => {
        const out: any = {}
        for (const key in p) {
            if (key !== "resolver") {
                out[key] = p[key as keyof typeof p]
            }
        }
        return out
    })
    return out
}


class CapabilityStatement
{
    /**
     * Get array of supported resources to be listed in the CapabilityStatement
     */
    getResources(): CapabilityStatementRestResource[]
    {
        return Object.keys(schema).map(key => getCapabilityStatementRestResource(schema[key]));
    }

    getOperations()
    {
        return [
            {
                "name": "get-resource-counts",
                "definition": "OperationDefinition/-s-get-resource-counts"
            },
            {
                "extension": [
                  {
                    "url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation",
                    "valueCode": "SHOULD"
                  }
                ],
                "name": "export",
                "definition": "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export"
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
            fhirVersion: "4.0.1",
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

    const statement = new CapabilityStatement();

    res
        .set("content-type", "application/fhir+json; charset=utf-8")
        .send(JSON.stringify(statement.toJSON(), null, 4));
}
