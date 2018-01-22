const Readable     = require('stream').Readable;
const config       = require("./config");
const QueryBuilder = require("./QueryBuilder");
const DB           = require("./db");
const Lib          = require("./lib");


const HEX    = "[a-fA-F0-9]"
const RE_UID = new RegExp(`\\b(${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12})\\b`, "g");


/**
 * Given a query builder and a state object, counts the total number of rows
 * and sets the following variables into the state:
 *      total      - the total rows
 *      page       - the page number we are currently in
 *      totalPages - the total number of pages available
 * @param {QueryBuilder} builder 
 * @param {Object} state 
 * @returns {Promise<Object>} Resolves with the state
 */
function countRecords(state) {
    let { sql, params } = state.builder.compileCount("totalRows");
    return DB.promise("get", sql, params)
        .then(row => {
            state.total = row.totalRows;
            state.page = Math.floor(state.offset / state.limit) + 1;
            state.totalPages = Math.ceil((state.total * state.multiplier) / state.limit);
            return state;
        });
}

/**
 * Given a query builder and a state object, prepares the select statement and
 * stores it into the state.
 * @param {QueryBuilder} builder 
 * @param {Object} state 
 * @returns {Promise<Object>} Resolves with the state
 */
function prepare(state) {
    let { sql, params } = state.builder.compile();
    state.params = params;
    return new Promise((resolve, reject) => {
        let statement = DB.prepare(sql, params, prepareError => {
            if (prepareError) {
                return reject(prepareError);
            }
            state.statement = statement;
            resolve(state);
        });
    });
}

/**
 * Executes the statement and gets the next row if available.
 * @param {Object} state 
 * @returns {Promise<Object|undefined>} Resolves with the row (or undefined)
 */
function getRow(state) {
    return new Promise((resolve, reject) => {
        state.statement.get(state.params, (err, row) => {
            if (err) {
                return reject(err);
            }
            resolve(row);
        });
    })
}

/**
 * Pipes the input stream to the response stream. When the data is sent we
 * recurse into another getNextRow call and eventually resolve with the state.
 * 
 * @param {ReadableStream} input 
 * @param {Object} state 
 */
function writeRow(input, state) {
    return new Promise((resolve, reject) => {
        input.on("error", reject);
        input.pipe(state.res, { end: false });
        input.on("end", () => Lib.wait(config.throttle).then(
            () => resolve(getNextRow(state))
        ));
    })
}

/**
 * Gets the next row (if any) and then decides what to do with it, depending on
 * the state.
 * @param {Object} state 
 */
function getNextRow(state) {
    return getRow(state).then(row => {

        // If we have read enough rows already - exit
        if (state.rowIndex >= state.limit) {
            return state;
        }

        // If there is no row returned - check why
        if (!row) {

            // If state.multiplier is greater than 1, then we might have to
            // rewind and continue (using prefixed IDs in the data)
            if (state.rowIndex < (state.total * state.multiplier - state.offset) &&
                state.page <= state.totalPages
            ) {
                state.params.$_offset = 0;
                return getNextRow(state);
            }

            // Otherwise just exit
            return state;
        }

        // Compute the page on which the current row happens to be. If this
        // happens to be greater than 1, IDs will be prefixed.
        state.page = Math.floor((state.offset + state.rowIndex) / state.limit) + 1;

        // Increment the OFFSET with one
        state.params.$_offset += 1;

        // Write the current row to the HTTP response stream and continue.
        return writeRow(

            // Create readable stream that will consume the g-zipped JSON data and
            // pipe it to the HTTP response.
            new ReadableStream(Buffer.from(row.resource_json), {

                // Prepend "\n" before each line to form NDJSON response. This
                // way we don't have \n in the beginning and on the end.
                prependNewLine: ++state.rowIndex > 1,

                // Prefix IDs if we are on page other than the first page
                idPrefix: state.page > 1 ? `p${state.page}-${state.rowIndex}-` : "",

                // There is special "extended" parameter that is passed while
                // running tests. In that case the "modified_date" column is
                // also included in the SQL queries and will be included in the
                // JSON as "__modified_date" property of the resource.
                extra: state.extended ? {
                    __modified_date: row.modified_date
                } : null
            }),
            state
        );
    });
}

module.exports = function(req, res) {

    const args = req.sim;

    return Promise.resolve({
        limit      : Lib.uInt(args.limit, config.defaultPageSize),
        multiplier : Lib.uInt(args.m, 1),
        offset     : Lib.uInt(args.offset, 0),
        extended   : Lib.bool(args.extended),
        total      : 0,
        rowIndex   : 0,
        req,
        res,
        args,
        builder: new QueryBuilder({
            limit  : 1,
            offset : Lib.uInt(args.offset, 0),
            group  : args.group,
            start  : args.start,
            columns: Lib.bool(args.extended) ? ["resource_json", "modified_date"] : ["resource_json"],
            type   : [req.params.file.split(".")[1]]
        })
    })
    .then(countRecords)
    .then(prepare)
    .then(getNextRow)
    .then(state => {
        state.statement.finalize()
        res.end()
    }, error => {
        console.error(error);
        return res.status(500).end();
    });
};


class ReadableStream extends Readable {

    /**
     * @param {String} str Serialized JSON
     * @param {Object} options Stream options
     */
    constructor(str, options) {
        super(options);
        this.options = options;
        this._str = String(str || "");
    }

    _read() {
        if (!this.ended) {
        
            let str = this._str;

            if (this.options.idPrefix) {
                str = str.replace(RE_UID, this.options.idPrefix + '$1');
            }

            if (this.options.extra) {
                str = JSON.parse(str);
                Object.assign(str, this.options.extra);
                str = JSON.stringify(str);
            }

            if (this.options.prependNewLine) {
                str = "\n" + str;
            }

            this.push(str);
            this.push(null);
            this.ended = true;
        }
    }
}
