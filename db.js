const sqlite3 = require("sqlite3");
const { Readable } = require('stream');
const config = require("./config");

const HEX    = "[a-fA-F0-9]"
const RE_UID = new RegExp(`\\b(${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12})\\b`, "g");
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

DB.stream = (state) => {
    let rowIndex = 0, timer, overflow = 0;

    function read() {
        timer = setTimeout(() => {
            state.statement.get(state.params, (err, row) => {

                // Exit if error
                if (err) {
                    // this.push(null);
                    console.log(err);
                    process.nextTick(() => this.emit('error', err));
                    return;
                }

                // If we have read enough rows already - exit
                if (rowIndex >= state.limit) {
                    this.push(null);
                    return;
                }

                // If there is no row returned - check why
                if (!row) {
                    

                    // If state.multiplier is greater than 1, then we might have to
                    // rewind and continue (using prefixed IDs in the data)
                    if (rowIndex < (state.total * state.multiplier - state.offset) && state.page <= state.totalPages) {
                        // console.log(`2`)
                        // debugger;
                        overflow++
                        state.params.$_offset = 0;
                        return read.call(this);
                    }

                    // Otherwise just exit
                    this.push(null);
                    return;
                }

                // Compute the page on which the current row happens to be. If this
                // happens to be greater than 1, IDs will be prefixed.
                state.page = Math.floor((state.offset + rowIndex) / state.limit) + 1;

                // Increment the OFFSET with one
                state.params.$_offset += 1;

                let json = row.resource_json, prefix = "";

                if (state.page > 1) {
                    // prefix += p${state.page}
                    json = json.replace(RE_UID, `p${state.page}-${rowIndex}-` + '$1');
                }
                else 
                if (overflow) {
                    // ++overflow
                    json = json.replace(RE_UID, `o${overflow}-${rowIndex}-` + '$1');
                }

                if (state.extended) {
                    json = JSON.parse(json);
                    json.__modified_date = row.modified_date
                    json = JSON.stringify(json);
                }

                this.push((rowIndex ? "\n" : "") + json);

                rowIndex += 1;
            });
        }, config.throttle || 20);
    }

    return new Readable({
        objectMode: true, // Whether this stream should behave as a stream of objects. Meaning that stream.read(n) returns a single value instead of a Buffer of size n. Defaults to false
        read,
        destroy(err, callback) {
            if (timer) {
                clearTimeout(timer)
            }
            if (callback) {
                callback(err)
            }
        }
    })
};


module.exports = DB;
