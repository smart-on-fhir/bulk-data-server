import config from "../../config"

export default {
  "resourceType": "OperationDefinition",
  "id": "dd0083b0c3592937fb466a5ba66fb110",
  "text": {
    "status": "generated",
    "div": "<div>$everything invoked on a group</div>"
  },
  "url": `${config.baseUrl}/fhir/OperationDefinition/Group-i-everything`,
  "version": "1.0.0",
  "name": "Group-i-everything",
  "status": "draft",
  "kind": "operation",
  "experimental": true,
  "date": "2017-12-19T07:44:43+10:00",
  "publisher": "The SMART team at Boston Children's Hospital",
  "code": "everything",
  "system": false,
  "type": false,
  "instance": true,
  "resource": [
    "Group"
  ],
  "parameter": [
    {
      "name": "start",
      "type": "dateTime",
      "use": "in",
      "min": 0,
      "max": "1",
      "documentation": "The start date/time means only records since the nominated time. In the absence of the parameter, it means all data ever."
    },
    {
      "name": "_type",
      "type": "string",
      "use": "in",
      "min": 0,
      "max": "1",
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
};
