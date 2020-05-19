const TaskManager = require("./TaskManager");
const DownloadTaskCollection = require("./DownloadTaskCollection");


// Kick-off endpoint -----------------------------------------------------------
async function kickOff(payload)
{
    const batch = new DownloadTaskCollection(payload);
    TaskManager.add(batch);
    await batch.start();
    return batch.id;
}

// Status endpoint -------------------------------------------------------------
function pool(task, i = 0)
{
    const { position, progress, remainingTime } = task;

    if (progress == -1) {
        if (++i === 10) {
            throw new Error("Failed to start the import task");
        }
        return setTimeout(() => pool(task, i), 200);
    }
    let pct = Math.round(100 * progress);
    process.stdout.write(
        "\r\033[2K" + "▉".repeat(pct) + "░".repeat(100 - pct) + " " +
        Math.round(position/(1024 * 1024)) + "MB downloaded " +
        (remainingTime === -1 ? "" :  Math.ceil(remainingTime/1000) + "s remaining")
    );

    if (progress < 1) {
        setTimeout(() => pool(task), 100);
    }
    else {
        console.log(
            "\n==============================================================" +
            "\nUpload Complete!"                                               +
            "\n==============================================================" +
            "\n" + JSON.stringify(task, null, 4)
        );
        // console.dir(task.tasks);
    }
}

function status(taskId)
{
    const task = TaskManager.get(taskId);
    if (task && task.progress < 1) {
        pool(task);
    }
}

async function init(payload)
{
    const taskId = await kickOff(payload);
    status(taskId);
}

// =============================================================================

init({
    inputFormat  : "application/fhir+ndjson",
    inputSource  : "https://other-server.example.org",
    storageDetail: {
        type: "https"
    },
    input: [
        {
            url : "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Patient.ndjson",
            type: "Patient"
        },
        {
            url : "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Procedure.ndjson",
            type: "Procedure"
        },
        {
            url : "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Observation.ndjson",
            type: "Observation"
        },
        {
            url : "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Immunization.ndjson",
            type: "Immunization"
        },
        {
            url : "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Condition.ndjson",
            type: "Condition"
        },

        // GC Bucket - public file
        {
            url : "https://storage.googleapis.com/sandbox_bulk_data_r3/Patient.ndjson",
            type: "Patient"
        },

        // GC Bucket - private file (should error)
        {
            url: "https://storage.googleapis.com/sandbox_bulk_data_r3/Condition.ndjson",
            type: "Condition"
        }
    ]
});
