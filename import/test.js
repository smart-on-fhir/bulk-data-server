const TaskManager = require("./TaskManager");
const DownloadTaskCollection = require("./DownloadTaskCollection");


// Kick-off endpoint -----------------------------------------------------------
async function kickOff(payload)
{
    const batch = new DownloadTaskCollection(payload.input);
    TaskManager.add(batch);
    await batch.start();
    return batch.id;
}

// Status endpoint -------------------------------------------------------------
function pool(task)
{
    const { position, progress, remainingTime } = task;
    let pct = Math.round(100 * progress);

    process.stdout.write(
        "  " + "▉".repeat(pct) + "░".repeat(100 - pct) + " " +
        Math.round(position/(1024 * 1024)) + "MB downloaded " +
        Math.ceil(remainingTime/1000) + "s remaining" + "          \r"
    );

    if (progress < 1) {
        setTimeout(() => pool(task), 100);
    }
    else {
        console.log(
            "\n==============================================================" +
            "\nUpload Complete!"                                               +
            "\n=============================================================="
        );
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
            url : "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Immunizations.ndjson",
            type: "Immunization"
        },
        {
            url : "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Condition.ndjson",
            type: "Condition"
        }
    ]
});
