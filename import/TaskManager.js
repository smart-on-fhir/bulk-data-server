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
        setTimeout(() => remove(task.id), 60000);
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

module.exports = {
    get,
    add,
    remove,
    has
};
