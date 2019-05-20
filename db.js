const sqlite3 = require("sqlite3");

/**
 * Stores one database instance per fhir version
 */
const DB_INSTANCES = {};

function getDatabase(fhirVersion)
{
    if (!DB_INSTANCES[fhirVersion]) {
        const DB = new sqlite3.Database(
            `${__dirname}/database.r${fhirVersion}.db`
        );

        /**
         * Calls database methods and returns a promise
         * @param {String} method
         * @param {[*]} args 
         */
        DB.promise = (...args) =>
        {
            let [method, ...params] = args;
            return new Promise((resolve, reject) => {
                DB[method](...params, (error, result) => {
                    if (error) {
                        return reject(error);
                    }
                    resolve(result);
                });
            });
        };

        DB_INSTANCES[fhirVersion] = DB;
    }

    return DB_INSTANCES[fhirVersion];
}

module.exports = getDatabase;
