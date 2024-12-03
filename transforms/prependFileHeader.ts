import { Transform } from "stream"


export default function prependFileHeader(organizeOutputBy: string) {
    let headerAdded = false
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: true,
        transform(row, _encoding, next) {
            if (!headerAdded) {
                const groupId = organizeOutputBy === "Patient" ?
                    row.patient_id :
                    organizeOutputBy === "Group" ?
                        row.group_id :
                        organizeOutputBy === "Organization" ?
                            row.org :
                            null;

                if (groupId) {
                    this.push({
                        resource_json: {
                            resourceType: "Parameters",
                            parameter: [{
                                name: "header",
                                valueReference: {
                                    reference: `${organizeOutputBy}/${groupId}`
                                }
                            }]
                        }
                    })
                    headerAdded = true
                }
            }
            next(null, row);
        }
    });
}
