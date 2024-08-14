import sqlite3 from "sqlite3"

type DbMethodName = "run" | "get" | "all" | "each" | "exec" | "prepare"

export interface CustomizedDB extends sqlite3.Database {
    promise: (method: DbMethodName, ...args: any[]) => Promise<any>
}

/**
 * Stores one database instance per fhir version
 */
const DB_INSTANCES: Record<number, CustomizedDB> = {};

function getDatabase(fhirVersion: number)
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
        Object.defineProperty(DB, "promise", {
            get() {
                return function(method: DbMethodName, ...args: any[]) {
                    return new Promise((resolve, reject) => {
                        args.push((error: Error, result: any) => {
                            if (error) {
                                return reject(error);
                            }
                            resolve(result);
                        });
                        (DB[method] as (...args: any[]) => any)(...args);
                    });
                }
            }
        });

        DB_INSTANCES[fhirVersion] = DB as CustomizedDB;
    }

    return DB_INSTANCES[fhirVersion];
}

export default getDatabase;
