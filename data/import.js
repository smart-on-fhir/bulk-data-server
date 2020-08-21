const moment = require("moment");
const uuid   = require("uuid");
const App    = require("commander");
const fs     = require("fs");
const Path   = require("path");
const db     = require("../db");
const Lib    = require("../lib");
require("colors");

let DB;

// @see assignTimes
const TIME_MAP = {
    Observation       : ["issued", "effectiveDateTime"               ],
    Claim             : ["billablePeriod.start"                      ],
    Encounter         : ["period.start"                              ],
    Immunization      : ["date"                                      ],
    Procedure         : ["performedDateTime", "performedPeriod.start"],
    Condition         : ["onsetDateTime", "assertedDate"             ],
    MedicationRequest : ["authoredOn"                                ],
    DiagnosticReport  : ["issued", "effectiveDateTime"               ],
    CarePlan          : ["period.start"                              ],
    Organization      : [-30                                         ],
    Goal              : [-10                                         ],
    Patient           : [-10                                         ],
    AllergyIntolerance: ["assertedDate"                              ]
};

const GROUPS = [
    {
        weight: 9,
        id: 1,
        resource: createGroup({ name: "Blue Cross Blue Shield" })
    },
    {
        weight: 3,
        id: 2,
        resource: createGroup({ name: "BMC HealthNet" })
    },
    {
        weight: 1,
        id: 3,
        resource: createGroup({ name: "Fallon Health" })
    },
    {
        weight: 1,
        id: 4,
        resource: createGroup({ name: "Harvard Pilgrim Health Care" })
    },
    {
        weight: 8,
        id: 5,
        resource: createGroup({ name: "Health New England" })
    },
    {
        weight: 1,
        id: 6,
        resource: createGroup({ name: "Minuteman Health" })
    },
    {
        weight: 2,
        id: 7,
        resource: createGroup({ name: "Neighborhood Health Plan" })
    },
    {
        weight: 7,
        id: 8,
        resource: createGroup({ name: "Tufts Health Plan" })
    }
];

const URN_MAP = {};

function getInputDir()
{
    if (App.input) {
        return App.input;
    }

    switch (App.fhirVersion) {
        case "2":
            return Path.join(__dirname, "fhir_dstu2");
        case "3":
            return Path.join(__dirname, "fhir_stu3");
        case "4":
            return Path.join(__dirname, "fhir");
        default:
            throw new Error("Unable to determine the input directory");
    }
}

function randomMoment(after, before)
{
    const out = moment(after);
    let add = Math.random() * 60 * 60 * 24 * 365;
    if (before) {
        const beforeMoment = moment(before);
        let diff = beforeMoment.diff(out, "seconds");
        add = Math.random() * diff;
    }
    out.add(add, "seconds");
    return out;
}

function createGroup({ name, id = "", members = [], type = "person" })
{
    return {
        resourceType: "Group",
        id: id || uuid.v4(),
        active: true,
        type,
        actual: true,
        quantity: members.length,
        name,
        text: {
            status: "generated",
            div: `<div xmlns="http://www.w3.org/1999/xhtml">${name}</div>`
        },
        member: members
    };
}

/**
 * Walks the app input directory, filters json files only, parses them and calls
 * the callback with that JSON as argument
 * @param {(json: object) => any} callback 
 */
function loopFiles(callback)
{
    return Lib.forEachFile({
        dir   : getInputDir(),
        filter: path => path.endsWith(".json")
    }, callback);
}

/**
 * Reads the entries of a bundle and adds their urn uuids to the URN_MAP. Later,
 * this map will be used to translate URN refs to relative URLs.
 * @param {object} resource FHIR Bundle
 */
function updateUrnMap(resource)
{
    resource.entry.forEach(entry => {
        if (entry.fullUrl && entry.fullUrl.indexOf("urn:uuid:") === 0) {
            URN_MAP[entry.fullUrl] = `${entry.resource.resourceType}/${entry.resource.id}`;
        }
    });
}

/**
 * Walks the app input directory, filters json files only, parses them and
 * builds the URN_MAP
 * @returns {Promise<*>}
 */
function buildUrnMap()
{
    return loopFiles((path, fileStats, next) => {
        Lib.readJSON(path).then(json => {
            if (json.resourceType == "Bundle") {
                updateUrnMap(json);
            } else {
                URN_MAP[`urn:uuid:${json.id}`] = `${json.resourceType}/${json.id}`;
            }
        }).then(next, next);
    });
}

/**
 * Inserts one row into the data table
 * @param {string|number} resource_id
 * @param {String} resource_json 
 * @param {String} resourceType 
 * @param {String} time 
 * @param {String} patientId 
 * @param {Number} groupId
 */
function insertRow(resource_id, resource_json, resourceType, time, patientId, groupId)
{
    return DB.promise(
        "run",
        `INSERT INTO "data" (
            resource_id,
            resource_json,
            fhir_type,
            modified_date,
            group_id,
            patient_id
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
            resource_id,
            resource_json,
            resourceType,
            time || null,
            groupId,
            patientId
        ]
    );
}

/**
 * If the argument is scalar does nothing. Otherwise (object or array), walks it
 * finds references that begin with "urn:uuid:" and replaces them with the
 * corresponding value from URN_MAP. This is recursive.
 * @throws {Error} If a reference is not found in URN_MAP
 * @returns void
 * @param {*} obj The variable to try to translate
 */
function fixReferences(obj)
{    
    // if array just dive into it (it cannot have references anyway)
    if (Array.isArray(obj)) {
        return obj.every(fixReferences);
    }

    if (obj && typeof obj == "object") {
        for (let key in obj) {
            if (key == "reference") {
                let ref = obj[key];
                if (ref.indexOf("urn:uuid:") === 0) {
                    let newRef = URN_MAP[ref];
                    if (!newRef) {
                        throw new Error(`Cannot find a reference for "${ref}".`);
                    }
                    obj[key] = newRef;
                }
            }
            else {
                fixReferences(obj[key]);
            }
        }
    }
}

/**
 * Given a JSON bundle, insert everything onto the database
 * @param {Object} json
 * @returns {Promise<*>}
 */
async function insertBundle(json, path, num)
{
    assignTimes(json);
    const patient = json.entry.find(e => e.resource.resourceType == "Patient");
    const total = json.entry.length;
    let i = 0, skipped = 0;
    for (const entry of json.entry) {
        const pct = Math.round(++i / total * 100);
        let msg = "\033[2KFile " + num + ": " + path.bold + ": " + entry.resource.id + " ";
        msg += "▉".repeat(Math.ceil(pct/10)) + "░".repeat(Math.floor(10 - pct/10)) + " ";
        msg += pct + "%, "  + String(i).magenta.bold + " resources\r"; 
        process.stdout.write(msg);
        fixReferences(entry);
        try {
            await insertResource(entry, patient ? patient.resource.id : null, null);
        } catch (error) {
            if (error.code == "SQLITE_CONSTRAINT") {
                const row = await DB.promise("get", "SELECT * FROM data WHERE resource_id = ?", entry.resource.id);
                if (row.resource_json === JSON.stringify(entry.resource)) {
                    // process.stdout.write(
                    //     "\033[2K" + ("File " + num).red + ": " + path.bold + ": " + 
                    //     ("Duplicate record of type \"" + entry.resource.resourceType + "\" #" + entry.resource.id + "\n").red
                    // );
                    skipped++;
                    continue;
                }
                console.log("\033[2K%s\n", row.resource_json);
            }
            console.error(error);
            console.log("\033[2K" + ("File " + num).red + ": " + path.bold + ": Failed entry:\n%j", entry);
            break;
        }
    }
    process.stdout.write(
        "\r\033[2KFile " + num + ": " + String(path).bold + ": imported " +
        String(total).magenta.bold + " resources" + (skipped ? ", " + ("skipped " + skipped).yellow.bold : "") + "\n"
    );
}

/**
 * Walks the app input directory, and inserts all the bundles into the database
 * @returns {Promise<*>}
 */
function insertBundles()
{
    let i = 0;
    return loopFiles((path, fileStats, next) => {
        Lib.readJSON(path).then(json => {
            i++;
            if (json.resourceType == "Bundle") {
                return insertBundle(json, fileStats.name, i);
            }
            else {
                console.log(`===> Skipping file "${fileStats.name}" (not a bundle)`.red);
            }
        }).then(next, console.error);
    });
}

async function insertResource(entry, patientId, group) {

    let type = entry.resource.resourceType;
    
    let json = process.env.NODE_ENV == "test" ?
        {
            modified_date: entry.__time,
            type: type,
            id: entry.resource.id
        } :
        entry.resource;
     
    return Lib.stringifyJSON(json).then(json => insertRow(
        entry.resource.id,
        json,
        type,
        entry.__time,
        patientId,
        group
    ));
}

/**
 * Adds reasonable last-modified date to each json.entry as __time
 * @param {Object} json 
 * @returns {Object} The modified json
 */
function assignTimes(json) {
    let absMinDate = moment([2000, 0, 1]);
    json.entry.forEach(entry => {
        let type = entry.resource.resourceType;
        let paths = TIME_MAP[ type ] || [];

        for (const path of paths) {
            if (typeof path == "string") {
                entry.__time = moment(Lib.getPath(entry.resource, path) || absMinDate);
                break;
            }
        }

        if (!entry.__time) {
            entry.__time = randomMoment(absMinDate, moment());
        }

        if (entry.__time.isBefore(absMinDate, "year")) {
            entry.__time = moment(absMinDate);
        }
        entry.__time = entry.__time.format();
    });

    return json
}

function createDatabase() {
    return DB.promise("run", `DROP TABLE IF EXISTS "data"`)
    .then(() => DB.promise(
        "run",
        `CREATE TABLE "data"(
            "id"            Integer NOT NULL PRIMARY KEY AUTOINCREMENT,
            "resource_id"   Text UNIQUE ON CONFLICT REPLACE,
            "patient_id"    Text,
            "fhir_type"     Text,
            "modified_date" DateTime,
            "group_id"      Text,
            "expires_at"    DateTime,
            "resource_json" Text
        );`
    ));
}

async function insertGroups()
{
    let totalWeight = GROUPS.reduce((out, g) => out + g.weight, 0);

    const patients = await DB.promise("all", "SELECT * FROM data WHERE fhir_type = 'Patient'");

    const groups = GROUPS.map(g => ({
        id      : g.id,
        weight  : g.weight / totalWeight,
        cur     : 0,
        resource: g.resource
    }));

    let i = 0;
    for (const patient of patients) {
        process.stdout.write(`\rUpdating resources for patient #${patient.resource_id}`);

        // pick a group for this patient
        let group = groups.sort((a, b) => a.cur - b.cur)[0];

        // Update the patient resources to belong to this group
        await DB.promise(
            "run",
            `UPDATE "data" SET group_id = ? WHERE resource_id = ? OR patient_id = ?`,
            group.resource.id,
            patient.resource_id,
            patient.resource_id
        );

        // Add the patient to this group
        group.resource.quantity = group.resource.member.push({
            entity: {
                reference: "urn:uuid:" + patient.resource_id
            }
        });

        // Update group weights
        group.cur += 1 / group.weight;

        i++;
    }
    process.stdout.write("\r\033[2KUpdated " + i + " resources to belong to a Group\n");

    // insert groups
    for (const group of groups) {
        console.log(`Inserting group "${group.resource.name}"`);
        await DB.promise(
            "run",
            `INSERT INTO "data" (
                resource_id,
                resource_json,
                fhir_type,
                modified_date,
                group_id,
                patient_id
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            group.resource.id,
            JSON.stringify(group.resource),
            "Group",
            moment([2000, 0, 1]).format(),
            null,
            null
        );
    }
}

async function insertDocumentReferences()
{
    // find the first Patient
    // -------------------------------------------------------------------------
    const patient = await DB.promise(
        "get",
        "SELECT * FROM data WHERE fhir_type = 'Patient' LIMIT 1"
    );

    // find the first Practitioner
    // -------------------------------------------------------------------------
    const practitioner = await DB.promise(
        "get",
        "SELECT * FROM data WHERE fhir_type = 'Practitioner' LIMIT 1"
    );

    // Insert one DocumentReference with inline attachment
    // -------------------------------------------------------------------------
    console.log("Add one DocumentReference with inline attachment");
    
    const photoPath = Path.join(__dirname, "/../attachments/portrait-1.jpg");
    const photoData = fs.readFileSync(photoPath).toString("base64");
    const photoSize = Buffer.from(photoData).byteLength;

    const docRef1 = {
        resourceType: "DocumentReference",
        id: uuid.v4(),
        meta: {
            versionId: "1",
            lastUpdated: randomMoment("2018-05-25").format()
        },
        text: {
            status: "generated",
            div: "<div xmlns=\"http://www.w3.org/1999/xhtml\">User photo</div>"
        },
        status: "current",
        type: {
            coding: [
                {
                    system: "http://loinc.org",
                    code  : "72170-4",
                    display: "Photographic image Unspecified body region Document"
                }
            ],
            text: "User photo"
        },
        subject: {
            reference: `Patient/${patient.resource_id}`
        },
        created: randomMoment("2016-05-25", "2018-05-25").format(),
        indexed: randomMoment("2019-05-25").format(),
        author: [
            {
                "reference": `Practitioner/${practitioner.resource_id}`
            }
        ],
        "description": "User photo",
        "content": [
            {
                "attachment": {
                    "contentType": "image/jpeg",
                    // "url" : `/Binary/${binaryId}`,
                    "data": photoData,
                    "size": photoSize
                }
            }
        ]
    };

    if (App.fhirVersion == "4") {
        docRef1.date = docRef1.created;
        delete docRef1.created;
        delete docRef1.indexed;
    }

    await insertRow(
        docRef1.id,
        JSON.stringify(docRef1),
        "DocumentReference",
        docRef1.meta.lastUpdated,
        patient.resource_id,
        patient.group_id
    );

    // Insert one DocumentReference resource to link to an image file
    // -------------------------------------------------------------------------
    console.log("Add one DocumentReference to DICOM image");
    const docRef2 = {
        resourceType: "DocumentReference",
        id : uuid.v4(),
        meta: {
            versionId: "1",
            lastUpdated: randomMoment("2018-05-25").format()
        },
        text: {
            status: "generated",
            div: "<div xmlns=\"http://www.w3.org/1999/xhtml\">DICOM Image</div>"
        },
        status: "current",
        type: {
            coding: [
                {
                    system: "http://loinc.org",
                    code: "55113-5",
                    display: "Key images Document Radiology"
                }
            ],
            text: "DICOM Image"
        },
        subject: {
            reference: `Patient/${patient.resource_id}`
        },
        created: randomMoment("2016-05-25", "2018-05-25").format(),
        indexed: randomMoment("2019-05-25").format(),
        author: [
            {
                reference: `Practitioner/${practitioner.resource_id}`
            }
        ],
        description: "DICOM Image",
        content: [
            {
                attachment: {
                    contentType:"image/jpeg",
                    url:"/attachments/DICOM.jpg",
                    size: 190326
                }
            }
        ]
    };

    if (App.fhirVersion == "4") {
        docRef2.date = docRef2.created;
        delete docRef2.created;
        delete docRef2.indexed;
    }

    await insertRow(
        docRef2.id,
        JSON.stringify(docRef2),
        "DocumentReference",
        docRef2.meta.lastUpdated,
        patient.resource_id,
        patient.group_id
    );

    // Insert one DocumentReference resource to link to a PDF file
    // -------------------------------------------------------------------------
    console.log("Add one DocumentReference to PDF file");
    const docRef3 = {
        resourceType: "DocumentReference",
        id: uuid.v4(),
        meta: {
            versionId: "1",
            lastUpdated: randomMoment("2018-05-25").format()
        },
        text: {
            status:"generated",
            div: "<div xmlns=\"http://www.w3.org/1999/xhtml\">PDF Document</div>"
        },
        status: "current",
        type: {
            coding: [
                {
                    system: "http://loinc.org",
                    code: "69764-9",
                    display: "Document type"
                }
            ],
            text: "PDF Document"
        },
        subject: {
            reference: `Patient/${patient.resource_id}`
        },
        created: randomMoment("2016-05-25", "2018-05-25").format(),
        indexed: randomMoment("2019-05-25").format(),
        author: [
            {
                reference: `Practitioner/${practitioner.resource_id}`
            }
        ],
        description: "PDF Document",
        content: [
            {
                attachment: {
                    contentType: "application/pdf",
                    url        : "/attachments/document.pdf",
                    size       : 1084656
                }
            }
        ]
    };

    if (App.fhirVersion == "4") {
        docRef3.date = docRef3.created;
        delete docRef3.created;
        delete docRef3.indexed;
    }

    await insertRow(
        docRef3.id,
        JSON.stringify(docRef3),
        "DocumentReference",
        docRef3.meta.lastUpdated,
        patient.resource_id,
        patient.group_id
    );
}


async function main()
{
    // Connect to the specified database
    DB = db(App.fhirVersion);

    // build a map to be used for reference translation later
    await buildUrnMap();

    // (Re)create the database
    await createDatabase();

    // Insert FHIR bundle files
    await insertBundles();

    // Also add some DocumentReference resources
    await insertDocumentReferences();

    // Insert groups and update records to belong to them
    await insertGroups();

    // Close the DB connection
    DB.close();
}

// Run =========================================================================
App
    .version('0.1.0')
    .option('-d, --input <path>', 'Input folder containing JSON FHIR patient bundles', String)
    .option('-f, --fhir-version <version>', 'FHIR Version (2, 3 or 4)', String)
    .parse(process.argv);

if (App.fhirVersion) {
    try {
        main();
    } catch (e) {
        Lib.die(e);
    }
}
else {
    App.outputHelp();
}
