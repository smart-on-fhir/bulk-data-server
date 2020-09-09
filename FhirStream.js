const { Readable } = require("stream");
const config       = require("./config");
const Lib          = require("./lib");
const QueryBuilder = require("./QueryBuilder");
const getDB        = require("./db");

const HEX    = "[a-fA-F0-9]"
const RE_UID = new RegExp(
    `"id":"(${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12})"`,
    "g"
);

class FhirStream extends Readable
{
    /**
     * 
     * @param {object} options
     * @param {number} options.stu
     * @param {string} options.fileName
     * @param {number} [options.limit]
     * @param {number} [options.databaseMultiplier]
     * @param {number} [options.offset]
     * @param {boolean} [options.extended]
     * @param {string} [options.group]
     * @param {string} [options.since]
     * @param {boolean} [options.systemLevel]
     * @param {string[]|null} [options.patients]
     */
    constructor(options)
    {
        super({ objectMode: true });

        this.db = getDB(+options.stu);

        this.limit      = Lib.uInt(options.limit, config.defaultPageSize);
        this.multiplier = Lib.uInt(options.databaseMultiplier, 1);
        this.offset     = Lib.uInt(options.offset, 0);
        this.extended   = Lib.bool(options.extended);
        this.patients   = options.patients || null;
        this.group      = options.group || "";
        this.start      = options.since || "";
        this.types      = [options.fileName.split(".")[1]];
        this.params     = {};
        this.cache      = [];
        this.statement  = null;
        this.page       = 0;
        this.total      = 0;
        this.rowIndex   = 0;
        this.overflow   = 0;

        this.timer = null

        this.builder = new QueryBuilder({
            limit      : this.limit,
            offset     : this.offset,
            group      : this.group,
            start      : this.start,
            type       : this.types,
            systemLevel: options.systemLevel,
            patients   : this.patients,
            columns    : this.extended ?
                ["resource_json", "modified_date"] :
                ["resource_json"]
        });

        this.getNextRow  = this.getNextRow .bind(this);

        this._read = () => {
            this.timer = setTimeout(this.getNextRow, config.throttle || 0);
        };
    }

    _destroy(err, callback)
    {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        callback && callback(err);
    }

    init()
    {
        return this.countRecords()
            .then(() => this.prepare())
            .then(() => this.fetch())
            .then(() => this)
            .catch(error => {
                this.emit('error', error);
                return this;
            });
    }

    /**
     * Prepares the select statement and stores it on the instance.
     * @returns {Promise<FhirStream>} Resolves with the instance
     */
    prepare()
    {
        let { sql, params } = this.builder.compile();
        this.params = params;
        return new Promise((resolve, reject) => {
            this.statement = this.db.prepare(sql, params, prepareError => {
                if (prepareError) {
                    return reject(prepareError);
                }
                resolve(this);
            });
        });
    }

    /**
     * Counts the total number of rows and sets the following properties on the
     * instance:
     *      total    - the total rows
     *      page     - the page number we are currently in
     *      overflow - the number of rewinds
     * @returns {Promise<FhirStream>} Resolves with the instance
     */
    countRecords()
    {
        // SELECT "fhir_type", COUNT(*) as "totalRows" FROM "data"
        // WHERE "fhir_type" IN("Patient") GROUP BY "fhir_type"
        let { sql, params } = this.builder.compileCount();
        return this.db.promise("get", sql, params).then(row => {
            this.total = row && row.rowCount ? row.rowCount || 0 : 0;
            this.page = Math.floor(this.offset / this.limit) + 1;
            this.overflow = Math.floor(this.offset/this.total);
            return this;
        });
    }

    /**
     * Executes the SQL statement to fetch the next set of rows and load them
     * into the memory cache
     */
    fetch()
    {
        return new Promise((resolve, reject) => {
            this.params.$_limit = Math.min(config.rowsPerChunk, this.limit);
            this.statement.all(this.params, (err, rows) => {
                if (err) {
                    return reject(err);
                }
                this.cache = rows || [];
                this.params.$_offset += this.cache.length;
                resolve(this);
            });
        });
    }

    getNextRow()
    {
        // If we have read enough rows already - exit
        if (this.rowIndex >= this.limit) {
            return this.push(null);
        }

        const row = this.cache.length ? this.cache.shift() : null;

        // If there is no row returned - check why
        if (!row) {

            // the record index within the file
            const localRecordIndex  = this.rowIndex;

            // the record number within the entire set of resources (within multiple files)
            const globalRecordIndex = localRecordIndex + this.offset;

            // How many DB queries we will have to execute
            const totalPages = Math.ceil((this.total * this.multiplier) / this.params.$_limit);

            // the index of the last record across all files (25582) 25410
            const lastGlobalRecordIndex = Math.min(this.total * this.multiplier, totalPages * this.limit);

            // the index of the last record in this file
            // const lastLocalRecordIndex = Math.min(this.page * this.limit, this.total * this.multiplier) - globalRecordIndex;
            

            if (globalRecordIndex < lastGlobalRecordIndex) {
                if (globalRecordIndex > 0 && globalRecordIndex % this.total === 0) {
                    this.overflow++;
                    this.params.$_offset = 0;
                }
                
                if (this.params.$_offset >= this.total) {
                    this.params.$_offset = this.params.$_offset - this.total
                }
                
                return this.fetch().then(this.getNextRow);
            }

            // Otherwise just exit
            return this.push(null);
        }

        // Compute the page on which the current row happens to be. If this is
        // greater than 1, IDs will be prefixed.
        this.page = Math.floor((this.offset + this.rowIndex) / this.limit) + 1;


        // Compute an ID prefix to make sure all records are unique
        let prefix = [], l = 0;

        if (this.overflow) {
            l = prefix.push(`o${this.overflow}`);
        }
        if (l) {
            row.resource_json = row.resource_json.replace(RE_UID, `"id":"${prefix.join("-")}-` + '$1' + '"');
        }

        row.resource_json = JSON.parse(row.resource_json);

        // For tests also include the modified_date
        if (this.extended) {
            row.resource_json.__modified_date = row.modified_date
        }
        
        this.push(row);

        this.rowIndex += 1;
    }
}

module.exports = FhirStream;
