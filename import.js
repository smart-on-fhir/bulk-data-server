const moment = require("moment");
const DB     = require("./db")(3);
const Lib    = require("./lib");
const App    = require('commander');


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
        resource: {
            "resourceType":"Group",
            "id":"3d7d2344-ca49-40ac-9e1f-88b40fff3bd9",
            "type":"person",
            "actual":true,
            "quantity":3375,
            "name":"Blue Cross Blue Shield",
            "text":{
                "status":"generated",
                "div":"<div xmlns=\"http://www.w3.org/1999/xhtml\">Blue Cross Blue Shield</div>"
            }
        }
    },
    {
        weight: 3,
        id: 2,
        resource: {
            "resourceType":"Group",
            "id":"a58071e4-ba37-48e3-d116-6cdf38107b57",
            "type":"person",
            "actual":true,
            "quantity":1287,
            "name":"BMC HealthNet",
            "text":{
                "status":"generated",
                "div":"<div xmlns=\"http://www.w3.org/1999/xhtml\">BMC HealthNet</div>"
            }
        }
    },
    {
        weight: 1,
        id: 3,
        resource: {
            "resourceType":"Group",
            "id":"3aa93632-9afb-4d91-d3bb-48a1572b970f",
            "type":"person",
            "actual":true,
            "quantity":404 ,
            "name":"Fallon Health",
            "text":{
                "status":"generated",
                "div":"<div xmlns=\"http://www.w3.org/1999/xhtml\">Fallon Health</div>"
            }
        }
    },
    {
        weight: 1,
        id: 4,
        resource: {
            "resourceType":"Group",
            "id":"c56f9ba9-bf36-43a9-c30d-5963d7cd486b",
            "type":"person",
            "actual":true,
            "quantity":800 ,
            "name":"Harvard Pilgrim Health Care",
            "text":{
                "status":"generated",
                "div":"<div xmlns=\"http://www.w3.org/1999/xhtml\">Harvard Pilgrim Health Care</div>"
            }
        }
    },
    {
        weight: 8,
        id: 5,
        resource: {
            "resourceType":"Group",
            "id":"6f4f7ae7-9662-4f50-9756-02127875c0a4",
            "type":"person",
            "actual":true,
            "quantity":2418,
            "name":"Health New England"         ,
            "text":{
                "status":"generated",
                "div":"<div xmlns=\"http://www.w3.org/1999/xhtml\">Health New England</div>"         
            }
        }
    },
    {
        weight: 1,
        id: 6,
        resource: {
            "resourceType":"Group",
            "id":"b19809ab-8d29-4381-8778-f8162b32defb",
            "type":"person",
            "actual":true,
            "quantity":828 ,
            "name":"Minuteman Health"           ,
            "text":{
                "status":"generated",
                "div":"<div xmlns=\"http://www.w3.org/1999/xhtml\">Minuteman Health</div>"           
            }
        }
    },
    {
        weight: 2,
        id: 7,
        resource: {
            "resourceType":"Group",
            "id":"4adcfdca-c352-4a47-aed7-fb5635da20a5",
            "type":"person",
            "actual":true,
            "quantity":632 ,
            "name":"Neighborhood Health Plan"   ,
            "text":{
                "status":"generated",
                "div":"<div xmlns=\"http://www.w3.org/1999/xhtml\">Neighborhood Health Plan</div>"   
            }
        }
    },
    {
        weight: 7,
        id: 8,
        resource: {
            "resourceType":"Group",
            "id":"e47262b6-e02a-435a-fdf1-023003bdec1a",
            "type":"person",
            "actual":true,
            "quantity":1789,
            "name":"Tufts Health Plan"          ,
            "text":{
                "status":"generated",
                "div":"<div xmlns=\"http://www.w3.org/1999/xhtml\">Tufts Health Plan</div>"         
            
            }
        }
    }
];

const URN_MAP = {};

let _types = {};

let secondLoop = []

function updateUrnMap(json) {
    json.entry.forEach(entry => {
        if (entry.fullUrl && entry.fullUrl.indexOf("urn:uuid:") === 0) {
            URN_MAP[entry.fullUrl] = `${entry.resource.resourceType}/${entry.resource.id}`;
        }
    });
}

/**
 * Inserts one row into the data table
 * @param {String} resource_json 
 * @param {String} resourceType 
 * @param {String} time 
 * @param {String} patientId 
 * @param {Number} group 
 */
function insertRow(resource_json, resourceType, time, patientId, groupId) {
    return DB.promise(
        "run",
        `INSERT INTO "data" (
            resource_json,
            fhir_type,
            modified_date,
            group_id,
            patient_id
        ) VALUES (?, ?, ?, ?, ?)`,
        [
            resource_json,
            resourceType,
            time || null,
            groupId,
            patientId
        ]
    );
}

function fixReferences(obj) {
    
    // if array just dive into it (it cannot have references anyway)
    if (Array.isArray(obj)) {
        return obj.every(fixReferences);
    }

    else if (obj && typeof obj == "object") {
        let result = true
        for (let key in obj) {
            if (key == "reference") {
                let ref = obj[key];
                if (ref.indexOf("urn:uuid:") === 0) {
                    let newRef = URN_MAP[ref];
                    if (!newRef) {
                        return false;
                    }
                    obj[key] = newRef;
                }
            }
            else {
                if (result) {
                    result = result && fixReferences(obj[key]);
                }
            }
        }
        return result;
    }

    return true;
}

async function insertResource(entry, patientId, group) {

    let type = entry.resource.resourceType;
    if (!_types[type]) {
        _types[type] = 1;
    } else {
        _types[type] += 1;
    }
    
    let json = process.env.NODE_ENV == "test" ?
        {
            modified_date: entry.__time,
            type: type,
            id: entry.resource.id
        } :
        entry.resource;
     
    return Lib.stringifyJSON(json).then(json => insertRow(
        json,
        type,
        entry.__time,
        patientId,
        group
    ));
}

async function getGroups() {
    let totalWeight = GROUPS.reduce((out, g) => out + g.weight, 0);
    return GROUPS.map(g => ({
        id    : g.id,
        weight: g.weight / totalWeight,
        cur   : 0
    }));
}

/**
 * Given a JSON bundle, insert everything onto the database
 * @param {Object} json
 * @returns {Promise<*>}
 */
function insertBundle(json, groups) {
    assignTimes(json);  
    let pt = json.entry.find(o => o.resource.resourceType == "Patient");

    // Skip bundles without a patient (if any)
    if (!pt) {
        return Promise.resolve();
    }

    let group = groups.sort((a, b) => a.cur - b.cur)[0];
    group.cur += 1 / group.weight;
    
    
    let job = Promise.resolve();
    json.entry.forEach(entry => {
        // Scan the resource to see if it contains references to URNs. If so,
        // Insert that resource first, get it's ID and modify the reference.
        if (fixReferences(entry)) {
            job = job.then(() => insertResource(entry, pt.resource.id, group.id))
        }
        else {
            secondLoop.push([entry, pt.resource.id, group.id])
        }
    });

    return job;
}

/**
 * Adds reasonable last-modified date to each json.entry as __time
 * @param {Object} json 
 * @returns {Object} The modified json
 */
function assignTimes(json) {
    let minDate = moment();
    let absMinDate = moment([2000, 0, 1]);
    let unHandled = []

    json.entry.forEach((entry, index) => {
        let type = entry.resource.resourceType;
        let paths = TIME_MAP[ type ] || [ -10 ];
        
        let time;

        paths.some(path => {
            if (typeof path == "string") {
                time = moment(Lib.getPath(entry.resource, path) || absMinDate);
                return true;
            }
            else {
                entry.__time = path;
                unHandled.push(index);
            }
        });

        if (time) {
            if (time.isBefore(absMinDate, "year")) {
                time = moment(absMinDate);
            }
            if (time.isBefore(minDate, "day")) {
                minDate = moment(time);
            }
            entry.__time = time.format();
        }
    });

    unHandled.forEach(index => {
        let entry = json.entry[index];
        entry.__time = minDate.subtract(Math.abs(entry.__time), "days");
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
            "patient_id"    Text,
            "resource_json" Text,
            "fhir_type"     Text,
            "modified_date" DateTime,
            "group_id"      Integer
        );`
    ))
    .then(() => DB.promise(
        "run",
        `INSERT INTO "data"("id", "resource_json", "fhir_type", "modified_date") VALUES ` +
        GROUPS.map(g => (
            `(${g.id}, '${JSON.stringify(g.resource)}', "Group", "${moment().format()}")`
        )).join(",")
    ));
}

function loopFiles(callback) {
    return Lib.forEachFile({
        dir   : App.input,
        filter: path => path.endsWith(".json"),
        limit : App.limit || 100
    }, callback);
}

function main() {
    // Create the database and insert the groups into it
    createDatabase()

    // Loop over the files to build the URN_MAP
    .then(() => loopFiles((path, fileStats, next) => {
        Lib.readJSON(path).then(updateUrnMap).then(next);
    }))

    // Create a structure with group id, weight and count
    .then(getGroups)

    // Loop over the files again and try to insert all resources
    .then(groups => {
        return loopFiles((path, fileStats, next) => {
            Lib.readJSON(path).then(json => {
                process.stdout.write("\033[2KInserting " + path + "...\r");
                return insertBundle(json, groups);
            }).then(() => next());
        })
    })

    // If anything could not be inserted the first time (because of missing
    // URN_MAP entry) it should be inserted now
    .then(() => {
        let job = Promise.resolve();
        while (secondLoop.length) {
            job = job.then(() => {
                let args = secondLoop.shift();
                if (!fixReferences(args[0])) {
                    return secondLoop.push(args);
                } else {
                    return insertResource(...args);
                }
            });
        }
        return job;
    })

    // Log the resource counts
    .then(() => console.log("\r\033[2K", _types))

    // Close the DB connection
    .then(() => DB.close())
    
    // Report the error and exit
    .catch(Lib.die); 
}

// Run =========================================================================
App
    .version('0.1.0')
    .option('-d, --input <path>', 'Input folder containing JSON FHIR patient bundles', String)
    .option('-l, --limit', 'Only import the first N patients', parseInt)
    .parse(process.argv);

if (App.input) {
    main();
}
else {
    App.outputHelp();
}
