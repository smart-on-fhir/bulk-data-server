const sqlite3 = require("sqlite3");

const DB = new sqlite3.Database(
    `${__dirname}/database.r3.imports.db`
);

module.exports = DB;
