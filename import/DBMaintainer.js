const config  = require("../config");
const DB      = require("./db");

class DBMaintainer
{
    /**
     * @type Array<(next: function) => any>
     */
    #tasks;

    constructor()
    {
        this.#tasks = [];

        const tick = (position = 0) => {
            if (position < this.#tasks.length) {
                return this.#tasks[position](error => {
                    if (error) {
                        console.error("Database maintenance error: %o", error);
                    }
                    tick(position + 1);
                });
            }
            setTimeout(tick, config.dbMaintenanceTickInterval).unref();
        };

        tick();
    }

    /**
     * Adds a function to the maintenance tasks
     * @param {(next: function) => any} task 
     */
    addTask(task)
    {
        this.#tasks.push(task);
    }
}

/**
 * Deletes all the records that are older than 1 minute
 * @param {(error?: Error) => any} next The callback function 
 */
function purgeOldDatabaseRecords(next)
{
    DB.run(
        `DELETE FROM "data" WHERE datetime(created_at) < datetime(?, "unixepoch")`,
        Date.now() / 1000 - config.dbMaintenanceMaxRecordAge,
        error => {

            // Ignore SQLITE_BUSY errors
            // @ts-ignore
            if (error && error.code === "SQLITE_BUSY") {
                return next();
            }

            // Ignore empty database
            if (error && error.message === "SQLITE_ERROR: no such table: data") {
                return next();
            }

            next(error);
        }
    );
}

const maintainer = new DBMaintainer();
maintainer.addTask(purgeOldDatabaseRecords);

module.exports = maintainer;
