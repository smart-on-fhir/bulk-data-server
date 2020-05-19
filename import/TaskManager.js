const config = require("../config");


const TASKS = {};


function get(id)
{
    return TASKS[id];
}

function add(task)
{
    if (has(task.id)) {
        throw new Error(`Task with ID of "${task.id}" already exists`);
    }
    TASKS[task.id] = task;
    task.once("end", () => {
        setTimeout(() => remove(task.id), config.dbMaintenanceMaxRecordAge * 1000).unref();
    });
}

function remove(id)
{
    if (has(id)) {
        delete TASKS[id];
        return true;
    }
    return false;
}

function has(id)
{
    return TASKS.hasOwnProperty(id);
}

/**
 * Returns:
 * -  0 - if all the tasks are completed
 * - -1 - if at least one task is not started yet (unknown time remaining)
 * - +n - positive int remaining time otherwise
 */
function getRemainingTime()
{
    let sum = 0;
    for (const taskId in TASKS) {
        const task = TASKS[taskId];
        const remainingTime = task.remainingTime;
        if (remainingTime < 0) {
            return -1;
        }
        sum += remainingTime;
    }
    return Math.ceil(sum);
}

function endAll()
{
    for (const taskId in TASKS) {
        TASKS[taskId].end();
        this.remove(taskId);
    }
}

module.exports = {
    get,
    add,
    remove,
    has,
    endAll,
    getRemainingTime
};
