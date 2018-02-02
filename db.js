const sqlite3 = require("sqlite3");

const DB = new sqlite3.Database(__dirname + "/database.db");

/**
 * Calls database methods and returns a promise
 * @param {String} method
 * @param {[*]} args 
 */
DB.promise = (...args) => {
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

module.exports = DB;
