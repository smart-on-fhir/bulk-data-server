# SMART Bulk Data Export Server Reference Implementation

<a href="https://bulk-data.smarthealthit.org" target="_blank">**Online Demo** 🔗</a>

**This is a highly configurable FHIR server implementing the bulk export operation in the [SMART Bulk Data Access Implementation Guide](https://hl7.org/fhir/uv/bulkdata/) together with optional [SMART Backend Services](https://www.hl7.org/fhir/smart-app-launch/backend-services.html) authorization.**

**It is intended to serve as a tool for developing and testing FHIR Bulk Export client applications and as a reference for server developers. Apart from the a subset of the APIs to create and manage FHIR Groups resources, the FHIR REST API is not supported.**

### Standards

- [Bulk Data Access IG STU2](https://hl7.org/fhir/uv/bulkdata/STU2/)
- [Proposed Export Features from Argonaut Bulk Optimize Project](https://build.fhir.org/ig/HL7/bulk-data/branches/argo24/export.html)
- [SMART Backend Services Authorization](https://www.hl7.org/fhir/smart-app-launch/backend-services.html)

### Data
The server includes a small dataset of 100 sample patients generated with [Synthea Tool](https://github.com/synthetichealth/synthea/wiki/Basic-Setup-and-Running). There is an option  to simulate larger datasets for testing, but this works by regenerating unique IDs while exporting, and the underlying data remains restricted to 100 patients. 

The data is read-only and the server does not support adding, removing, or updating resources. The only exception is the ability to create custom Groups as described below.

Note that this is not a full featured FHIR server and only supports the bulk export API.

Resources available on this server are in [FHIR R4 format](https://hl7.org/fhir/R4/resourcelist.html) and include: `AllergyIntolerance`, `CarePlan`, `CareTeam`, `Claim`, `Condition`, `Device`, `DiagnosticReport`, `DocumentReference`, `Encounter`, `ExplanationOfBenefit`, `Group`, `ImagingStudy`, `Immunization`, `MedicationRequest`, `Observation`, `Organization`,`Patient`, `Practitioner`, and `Procedure`.

### Export types
All export types are supported, including System, Group and Patient-level exports.

### Export parameters
- `_outputFormat` - supported values include `application/fhir+ndjson`, `application/ndjson`, `ndjson`, all of which produce output files in ndjson format.
- `_since` - supported
- `_type` - supported (see the available resource types listed above)
- `_elements` - supported
- `patient` - supported for group-level and patient-level exports
- `includeAssociatedData` - **NOT SUPPORTED**! This server does not support Provenance.
- `_typeFilter` - supports the `_filter` parameter on any resource, plus additional search parameters for every resource type. Please check the [Capability Statement](https://bulk-data.smarthealthit.org/fhir/metadata) to see what search parameters are available for each resource type.
- `organizeOutputBy` - supported values: `Patient`, `Organization`, `Group`
- `allowPartialManifests` - supported

### Output file naming conventions
Files are named as `{index}.{ResourceType}.{extension}` or `{index}.output.{extension}`, where `{index}` is an auto-incrementing numeric prefix starting from `1`, `{ResourceType}` is the resourceType of the resources included in that file, and `{extension}` is based on the format  specified in the `_outputFormat` parameter (defaulting to `ndjson`).

For example, if no `organizeOutputBy` parameter is provided and there are multiple Observation resource files, they will be named `1.Observation.ndjson`, `2.Observation.ndjson`, etc. However, if an `organizeOutputBy` parameter is used the files will contain resources of different types, therefore the files will be named `1.output.ndjson`, `2.output.ndjson`, etc.

For "deleted" files (listed in the "deleted" section of the manifest) the names will look like `{index}.{ResourceType}.deleted.{extension}` or `{index}.output.deleted.{extension}` when `organizeOutputBy` parameter is used.

### Output file splitting
- There is a default limit of `10,000` resources per file. If there are more resources than that, they will overflow into the next file. For testing purposes that limit can be configured on the server's home page.
- If the client uses `allowPartialManifests`, then there is a default limit of 10 manifest output entries per manifest page. This can also be changed from the server's home page.

### Other output file limitations
- The number of output files is limited to 150. If your export parameters result in more than 150 files, you will get a "too many files" error.
- The exported files expire in 60 minutes and the entire export is automatically deleted after that.

### Additional supporting resources
Some additional supporting resources such as Practitioner or Organization are included in the export.
- Practitioner and Organization resources are included in case of system-level export.
- Practitioner and Organization resources are included in case of patient-level and group-level export if they are related to the exported patient.

### Available Groups
There are 8 built-in groups and every patient is a member of one of those groups. For simplicity those groups have human-readable IDs like `BlueCrossBlueShield`. All pre-defined groups are listed on the home page.

### Managing Groups
In addition to the "fixed" groups described above, it is also possible to create temporary custom groups with the Argonaut [Bulk Cohort API](https://build.fhir.org/ig/HL7/bulk-data/branches/argo24/group.html#bulk-cohort-api). There are some limitations/requirements to consider when creating a custom group:
- Every group is required to have a `name`, the `type` property must be set to `"person"`, and the `actual` property must be set to `false`.
- The `member` property is accepted but it is ignored because custom groups are only intended to work using their `member-filter` extension.
- `modifierExtension` should be provided and should include one or more `member-filter` extensions. Otherwise the group will be useless since it won't have any expressions to use for finding members.
- Custom groups are temporary and are automatically deleted 7 days after the time if their last update (or create). Also, in some cases we might redeploy or restart the server which would delete any custom groups prematurely!
- Custom groups are only intended for personal testing and won't appear in the groups listing (`[fhirBaseUrl]/Group`)

## Installation
First you have to install NodeJS if you don't already have it from https://nodejs.org/. This app requires Node version 20+. We recommend using the [Node Version Manager (nvm)](https://github.com/creationix/nvm).

Then clone the repo, install the dependencies and start it:

```sh
git clone https://github.com/smart-on-fhir/bulk-data-server.git
cd bulk-data-server
nvm use # automatically select the preferred nodejs version if you use nvm
npm i
```

## Usage

Run the following command:
```sh
npm start
```
You should see "Server listening on http://localhost:9443", and can open that URL in your browser to load the server's front end.

The bulk-data server can be accessed by clients like the [FHIR Downloader](https://github.com/smart-on-fhir/sample-apps-stu3/tree/master/fhir-downloader). To connect a client, you will need the server's FHIR endpoint that is displayed in the "FHIR Server URL" field towards the bottom of the page.

The server can also handle authenticated requests using the [SMART Backend Services specification](http://docs.smarthealthit.org/authorization/backend-services/). To use it you should have a pair of RS256 private and public keys (the server only require you to input the public key). Alternatively, you can generate the key pair by clicking on the "Generate Keys" button. The other required piece is the "Service URL" which acts as a unique identifier of your client. Once you have the public key and the Service URL, the server will generate a `Client ID` for you. You can also download the settings a client will need in JSON format by using the "Download as JSON" button. These settings include:
- `private_key` - Only included if keys are generated by the server
- `client_id` - client_id to send while authorizing
- `fhir_url` - where to send your FHIR requests
- `token_url` - where to send your authorization requests
- `service_url` - client identifier

Note that changing options may also change some of these settings (the fields that change will flash green).

**Note: Changing settings on the landing page produces a dedicated FHIR base url that includes those settings embedded into it. Clients can then use that as base URL for bulk exports. The generated URL is displayed in the `FHIR Server URL` input field.**

## Configuration

You can customize your settings by editing the file `config.js`. You can also pass the following environment variables:

- `NODE_ENV` - Typically this is `production`, `development` or `test`. Defaults to `production`.
- `PORT` - The port to listen on. Defaults to `9444` for running tests and `9443` otherwise.
- `BASE_URL` - The base url for the link generation. Defaults to `http://localhost:${PORT}`.
- `SECRET` - The secret for signing jwt tokens. Defaults to "this-is-our-big-secret". You must set this one.

