const { Writable } = require("stream");
const DB           = require("./db");
const config       = require("../config");
require("./DBMaintainer");


class DatabaseWriter extends Writable
{
    #initialized = false;

    #writtenCount = 0;

    constructor()
    {
        super({ objectMode: true });
    }

    init()
    {
        if (this.#initialized) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            DB.exec(`CREATE TABLE IF NOT EXISTS "data" (
                "id"            Integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "patient_id"    Text,
                "resource_json" Text,
                "fhir_type"     Text,
                "created_at"    DateTime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "modified_date" DateTime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "group_id"      Integer
            );`, error => {
                this.#initialized = true;
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    writeChunk(chunk)
    {
        return new Promise((resolve, reject) => {
            DB.run(
                `INSERT INTO "data" (fhir_type, resource_json) VALUES (?, ?)`,
                chunk.resourceType, 
                JSON.stringify(chunk),
                error => {
                    this.#writtenCount += 1;
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    _write(chunk, encoding, callback)
    {
        if (this.#writtenCount > config.maxImportsPerResourceType) {
            return callback();
        }
        this.init().then(() => this.writeChunk(chunk)).then(callback, callback);
    }
}

module.exports = DatabaseWriter;
