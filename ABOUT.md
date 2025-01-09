- TODO: This is a reference implementation...
- TODO: Support FHIR R4, but is NOT a fhir server...
- TODO: We currently support Bulk Data v3 (although it says 2.0.0 at https://build.fhir.org/ig/HL7/bulk-data/branches/argo24/export.html)


### What data is included
The server includes a small dataset of 100 sample patients generated with Synthea. There is an option  to simulate larger datasets for testing, but that works by regenerating unique IDs while exporting, and the actual data remains restricted to 100 patients.

The data is read-only and we do not support adding, removing, or updating resources. The only exception is the ability to create custom Groups described below.

Note that this is not a real FHIR server and only aims to demonstrate the bulk export capabilities. There are various resources available for export but most of them are not accessible through the usual FHIR API.

The server does not restrict responses to a specific profile like the US Core Implementation Guide or the Blue Button Implementation Guide. The underlying resources are generated with Synthea and are exported without further modifications.

Resources available on this server include: `AllergyIntolerance`, `CarePlan`, `CareTeam`, `Claim`, `Condition`, `Device`, `DiagnosticReport`, `DocumentReference`, `Encounter`, `ExplanationOfBenefit`, `Group`, `ImagingStudy`, `Immunization`, `MedicationRequest`, `Observation`, `Organization`,`Patient`, `Practitioner`, and `Procedure`.

### What export types are supported
All export types are supported. That includes System, Group and Patient-level exports.

### Output file naming conventions
Files are named as `{index}.{ResourceType}.{extension}` or `{index}.output.{extension}`, where `{index}` is an auto-incrementing numeric prefix starting from `1`, `{ResourceType}` is the resourceType of the resources included in that file, and `{extension}` is `ndjson` or `csv`.
For example, if no `organizeOutputBy` parameter is provided and there are multiple patient files, they will be named `1.Patient.ndjson`, `2.Patient.ndjson`, etc. However, if `organizeOutputBy` is used the files will contain resources of different types, therefore the files will be named `1.output.ndjson`, `2.output.ndjson`, etc.

For "deleted" files (listed in the "deleted" section of the manifest) the names will look like `{index}.{ResourceType}.deleted.{extension}` or `{index}.output.deleted.{extension}`.


### Output file splitting
- There is a default limit of `10,000` resources per file. If there are more resources they will overflow into the next file. For testing purposes that limit can be configured on the home page.
- If the client uses `allowPartialManifests`, then there is a default limit of 10 manifest output entries per manifest page. This can also be changed from the home page.

### Other output file limitations
- The number of output files is limited to 150. If your export parameters result in more than 150 files, you will get a "too many files" error.
- The exported files expire in 60 minutes and the entire export is automatically deleted after that.

### Additional supporting resources
Some additional supporting resources such as Practitioner or Organization are included in the export.
- Practitioner and Organization resources are included in case of system-level export.
- Practitioner and Organization resources are included in case of patient-level export, if they are related to the exported patient.
- Only Practitioner resources are included in case of group-level export, if they are related to the exported patient.

### Export parameters
- `_outputFormat` - Supported values include `application/fhir+ndjson`, `application/ndjson`, `ndjson`, `text/csv`, and `csv`. Note that depending on the value of this parameter you will get different file extensions and content type headers. `ndjson` _outputFormat values will result in `.ndjson` files and `csv` will produce `.csv` files which are served with `text/csv; charset=UTF-8; header=present` contentType header.
- `_since` - supported
- `_type` - supported (see the available resources listed above)
- `_elements` - supported
- `patient` - supported for group-level and patient-level exports
- `includeAssociatedData` - **NOT SUPPORTED**! This server does not support Provenance.
- `_typeFilter` - We support the `_filter` parameter on any resource, plus additional search parameters for every resource type. Please check the CapabilityStatement to see what search parameters are available for each resource.
- `organizeOutputBy` - supported values: `Patient`, `Organization`, `Group`
- `allowPartialManifests` - supported

### Available Groups
There are 8 manually created groups and every patient is a member of one of those groups. For simplicity those groups have human-readable IDs like `BlueCrossBlueShield`. All pre-defined groups are listed on the home page.

### Managing Groups
In addition to the "fixed" groups described above, it is also possible to create temporary custom groups using FHIR Rest API calls. There are some limitations/requirements to consider when creating a custom group:
- Every group is required to have a `name`, the `type` property must be set to `"person"`, and the `actual` property must be set to `true`.
- The `member` property is accepted but it is ignored because custom groups are only intended to work using their `memberFilter` extension.
- `modifierExtension` should be provided and should include some `memberFilter` extensions. Otherwise the group will be useless since it won't have any expressions to use for finding it's members.
- Custom groups are temporary and are automatically deleted 7 days after the time if their last update (or create). Also, in some cases we might redeploy or restart the server which would delete any custom groups prematurely!
- Custom groups are only intended for personal testing and won't appear in the groups listing (`[fhirBaseUrl]/Group`)


