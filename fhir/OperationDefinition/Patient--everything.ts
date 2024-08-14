import config from "../../config"

export default {
  "resourceType": "OperationDefinition",
  "id": "55bccf047d03198946aeff7b130452fa",
  "text": {
    "status": "generated",
    "div": "<div>$everything invoked on patient level</div>"
  },
  "url": `${config.baseUrl}/fhir/OperationDefinition/Patient--everything`,
  "version": "1.0.0",
  "name": "Patient--everything",
  "status": "draft",
  "kind": "operation",
  "experimental": true,
  "date": "2017-12-19T07:44:43+10:00",
  "publisher": "The SMART team at Boston Children's Hospital",
  "description": "This operation is used to return all the information related to the patient described in the resource on which this operation is invoked. The response is a bundle of type \"searchset\". At a minimum, the patient resource itself is returned, along with any other resources that the server has that are related to the patient, and that are available for the given user. The server also returns whatever resources are needed to support the records - e.g. linked practitioners, medications, locations, organizations etc. The principle intended use for this operation is to provide a patient with access to their entire record (e.g. \"Blue Button\").  The server SHOULD return at least all resources that it has that are in the patient compartment for the identified patient, and any resource referenced from those, including binaries and attachments. In the US Realm, at a mimimum, the resources returned SHALL include all the data covered by the meaningful use common data elements as defined in [DAF](http://hl7.org/fhir/us/daf). Other applicable implementation guides may make additional rules about how much information that is returned",
  "code": "everything",
  "comment": "The key differences between this operation and simply searching the patient compartment are:  \n\n* unless the client requests otherwise, the server returns the entire result set in a single bundle (rather than using paging) \n* the server is responsible for determining what resources to return as included resources (rather than the client specifying which ones). This frees the client from needing to determine what it could or should ask for\n\nIt is assumed that the server has identified and secured the context appropriately, and can either associate the authorization context with a single patient, or determine whether the context has the rights to the nominated patient, if there is one. If there is no nominated patient (e.g. the operation is invoked at the system level) and the context is not associated with a single patient record, then the server should return an error. Specifying the relationship between the context, a user and patient records is outside the scope of this specification.",
  "system": false,
  "type": true,
  "instance": false,
  "resource": [
    "Patient"
  ],
  "parameter": [
    {
      "name": "start",
      "type": "dateTime",
      "use" : "in",
      "min" : 0,
      "max" : "1",
      "documentation": "The start date/time means only records since the nominated time. In the absence of the parameter, it means all data ever."
    },
    {
      "name": "_type",
      "type": "string",
      "use" : "in",
      "min" : 0,
      "max" : "1",
      "documentation": "The _type parameter is used to specify which resource types are part of the focal query – e.g. what kind of resources are returned in the main set. The _type parameter has no impact on which related resources are included) (e.g. practitioner details for clinical resources). In the absence of this parameter, all types are included."
    },
    {
      "name": "return",
      "use" : "out",
      "min" : 0,
      "max" : "*",
      "type": "Resource",
      "documentation": "Generates zero or more NDJSON files where each line is a resource"
    }
  ]
}