import { Transform } from "stream"
import base64url from "base64-url"
import { tagResource, buildUrlPath, getPath } from "../lib"
import config from "../config"
import { Resource } from "fhir/r4";


const { baseUrl, requiredElements } = config;

/**
 * When provided, the server SHOULD omit unlisted, non-mandatory elements from
 * the resources returned. Elements should be of the form
 * [resource type].[element name] (eg. Patient.id) or [element name] (eg. id)
 * and only root elements in a resource are permitted. If the resource type is
 * omitted, the element should be returned for all resources in the response
 * where it is applicable..
 *
 * Servers are not obliged to return just the requested elements. Servers SHOULD
 * always return mandatory elements whether they are requested or not. Servers
 * SHOULD mark the resources with the tag SUBSETTED to ensure that the incomplete
 * resource is not actually used to overwrite a complete resource.
 *
 * Servers unable to support _elements SHOULD return an error and
 * OperationOutcome resource so clients can re-submit a request omitting the
 * _elements parameter.
 * 
 * @param json The resource json 
 * @param elements Array of FHIR Elements
 */
function filterElements(json: Resource, elements: string[] = [])
{
    if (!elements || !elements.length) {
        return json;
    }

    const out: Partial<Resource> = {};

    const list = [ ...requiredElements, ...elements ];

    for (let element of list) {
        let [type, name] = element.split(/\s*\.\s*/);

        if (!name) {
            name = type;
            type = json.resourceType;
        }

        if (type !== json.resourceType) {
            continue;
        }

        if (json.hasOwnProperty(name)) {
            // @ts-ignore
            out[name] = json[name];
        }
    }

    tagResource(out, "SUBSETTED", "http://terminology.hl7.org/CodeSystem/v3-ObservationValue");

    return out;
}

function generateDeleteTransaction(json: Resource)
{
    return {
        resourceType: "Bundle",
        type: "transaction",
        entry:[
            {
                request: {
                    method: "DELETE", 
                    url   : `${json.resourceType}/${json.id}`
                }
            }
        ]
    };
}

export default function(sim: {
    deleted?: boolean
    _elements?: string[]
    secure?: boolean
    err?: string
} = {}) {
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: true,
        transform(row, _encoding, next) {
            try {

                if (!!sim.deleted) {
                    row.resource_json = generateDeleteTransaction(row.resource_json);
                }

                else {
                    // Filter by _elements if needed
                    if (Array.isArray(sim._elements)) {
                        row.resource_json = filterElements(row.resource_json, sim._elements);
                    }

                    // Rewrite urls in DocumentReference resources. Only url props
                    // that begin with `/files/` will be converted to absolute HTTP
                    // URLs to allow the client to directly download bigger files
                    if (row.resource_json.resourceType == "DocumentReference") {
                        const url = getPath(row.resource_json, "content.0.attachment.url");
                        if (url && url.search(/\/attachments\/.*/) === 0) {
                            row.resource_json.content[0].attachment.url = buildUrlPath(
                                baseUrl,
                                base64url.encode(JSON.stringify({
                                    err   : sim.err || "",
                                    secure: !!sim.secure
                                })),
                                "fhir",
                                url
                            );
                        }
                    }
                }

                next(null, row);
            } catch (error) {
                next(error as Error);
            }
        }
    });
}
