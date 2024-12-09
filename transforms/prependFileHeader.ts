import { Transform } from "stream"

const SUPPORTED_ORGANIZE_BY_TYPES = {
    ""            : "fhir_type",
    "Patient"     : "patient_id",
    "Group"       : "group_id",
    "Organization": "org"
}

export default function prependFileHeader(organizeOutputBy: keyof typeof SUPPORTED_ORGANIZE_BY_TYPES) {

    let lastStratifier = ""

    return new Transform({
        writableObjectMode: true,
        readableObjectMode: true,
        transform(row, _encoding, next) {
            const stratifier = row[SUPPORTED_ORGANIZE_BY_TYPES[organizeOutputBy]];
            if (stratifier !== lastStratifier) {
                lastStratifier = stratifier
                this.push({
                    resource_json: {
                        resourceType: "Parameters",
                        parameter: [{
                            name: "header",
                            valueReference: {
                                reference: `${organizeOutputBy}/${stratifier}`
                            }
                        }]
                    }
                })
            }
            next(null, row);
        }
    });
}
