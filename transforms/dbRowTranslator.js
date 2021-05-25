const Transform = require("stream").Transform;
const base64url = require("base64-url");
const lib       = require("../lib");
const { baseUrl, requiredElements } = require("../config");


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
 * @param {object} json The resource json 
 * @param {string[]} elements Array of FHIR Elements
 */
function filterElements(json, elements = [])
{
    if (!elements || !elements.length) {
        return json;
    }

    const out = {};

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
            out[name] = json[name];
        }
    }

    lib.tagResource(out, "SUBSETTED", "http://terminology.hl7.org/CodeSystem/v3-ObservationValue");

    return out;
}

function generateDeleteTransaction(json)
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

module.exports = function(sim = {}) {
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
                        const url = lib.getPath(row.resource_json, "content.0.attachment.url");
                        if (url && url.search(/\/attachments\/.*/) === 0) {
                            row.resource_json.content[0].attachment.url = lib.buildUrlPath(
                                baseUrl,
                                base64url.encode(JSON.stringify({
                                    err: sim.err || "",
                                    secure: !!sim.secure
                                })),
                                "fhir",
                                url
                            );
                        }
                    }
                }

                this.push(row);
                setImmediate(next);
            } catch (error) {
                setImmediate(next, error);
            }
        }
    });
};

