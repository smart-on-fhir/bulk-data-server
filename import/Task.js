const { EventEmitter } = require("events");
const crypto           = require("crypto");
const lib              = require("../lib");

class Task extends EventEmitter
{
    /**
     * The time when the task has been started (or 0 if it is not started yet)
     * @type {number}
     * @protected
     */
    #startTime = 0;

    /**
     * The time when the task was completed (or 0 if it is not complete yet)
     * @type {number}
     * @protected
     */
    #endTime = 0;

    /**
     * The total value as number (how much needs to be done). For example,
     * for a download task this would be the total bytes that must be
     * downloaded.
     * @type {number}
     * @protected
     */
    #total = 0;

    /**
     * The current position as number. For example, for a download task this
     * would be the the downloaded bytes.
     * @type {number}
     * @private
     */
    #position = 0;

    /**
     * Contains the last error (if any)
     * @type {string}
     */
    #error = null;
    
    constructor(options = {})
    {
        super();

        /**
         * Any custom options passed to the constructor
         */
        this.options = options;

        /**
         * Each task has an unique ID
         */
        this.id = crypto.randomBytes(32).toString("hex");
    }

    // Read-only properties ----------------------------------------------------

    /**
     * Returns the task uptime (how long it ran). The result would be `0` for
     * tasks that have not been started.
     * @returns {number}
     */
    get upTime()
    {
        if (!this.#startTime) {
            return 0;
        }

        return (this.#endTime || Date.now()) - this.#startTime;
    }

    /**
     * Returns the task progress as a float between 0 and 1. The result would be
     * `-1` for tasks that have not been started yet.
     * @returns {number}
     */
    get progress()
    {
        if (this.#endTime || this.#error) {
            return 1;
        }

        const total = this.total;

        // if we don't know the total size we cannot compute the progress
        if (total <= 0) {
            return -1;
        }

        return this.position / total;
    }

    /**
     * Returns the remaining time in milliseconds. Will return `-1` if the
     * remaining time is unknown and `0` if the task is complete.
     * Note that this is an estimate that is very unreliable in the first stage,
     * thus we return `-1` if the task progress is below 10%.
     * @returns {number}
     */
    get remainingTime()
    {
        const upTime = this.upTime;
        const progress = this.progress;

        // In the beginning of the task lifetime the remaining time calculation
        // is too unreliable. To avoid that, we return -1 if the progress is
        // less than 10%
        if (progress < 0.1) {
            return -1;
        }

        return (upTime * (1 / progress)) - upTime;
    }

    /**
     * Returns the time (as a timestamp in milliseconds) when the task has ended,
     * or `0` if has not.
     * @returns {number} 
     */
    get endTime()
    {
        return this.#endTime;
    }

    // Getters and Setters -----------------------------------------------------

    /**
     * Updates the current position (how much is done)
     * @param {number} val The value to set. Should be a positive integer
     * and will be converted to such if it isn't.
     * @public
     */
    set position(val)
    {
        val = lib.uInt(val);

        const oldPosition = this.#position;

        if (oldPosition === val) {
            return;
        }

        this.#position = val;

        const info = this.toJSON();

        if (oldPosition === 0) {
            this.emit("start", info);
        }

        this.emit("progress", info);

        if (this.#total && this.#position / this.#total >= 1) {
            this.end();
        }
    }

    /**
     * Returns the current position (how much is done) as number
     * @returns {number}
     * @public
     */
    get position()
    {
        return this.#position;
    }

    /**
     * Sets the total value as number (how much needs to be done).
     * @param {number} val The value to set. Should be a positive integer
     * and will be converted to such if it isn't.
     * @public
     */
    set total(val)
    {
        this.#total = lib.uInt(val);
    }

    /**
     * Returns the total value as number (how much needs to be done)
     * @returns {number}
     * @public
     */
    get total()
    {
        return this.#total;
    }

    /**
     * Sets the start time of the task.
     * NOTE that this should only be used once! Any subsequent attempts will be
     * ignored!
     * @param {number} t The start time in milliseconds
     */
    set startTime(t)
    {
        if (!this.#startTime) {
            this.#startTime = t;
        } else {
            console.warn(
                "Attempting to set the startTime of a task that has " +
                "already been started. Task options: %j", this.options
            );
        }
    }

    get error()
    {
        return this.#error;
    }
    
    set error(e)
    {
        this.#error = String(e);
    }

    // Methods -----------------------------------------------------------------

    /**
     * Some tasks may need to perform some async initialization operations.
     * This method should be implemented by the subclasses.
     * @returns {Promise<any>}
     */
    init()
    {
        return Promise.resolve();
    }

    /**
     * Every task must implement a `start` method
     * @abstract
     */
    start()
    {
        throw new Error(`The start() method must be implemented by the Task subclass`);
    }

    /**
     * Marks the task as ended by setting the #endTime to the current timestamp
     * @param {Error} [error] Optional error as reason for ending
     */
    end(error)
    {
        if (!this.#endTime) {
            this.#endTime = Date.now();
            if (error) {
                this.#error = String(error);
            }
            this.emit("end", this.toJSON());
        }
        return this;
    }

    /**
     * Represent the task as JSON, including some properties that are otherwise
     * private or invisible.
     * @returns {object}
     */
    toJSON()
    {
        return {
            id           : this.id,
            position     : this.position,
            total        : this.total,
            progress     : this.progress,
            upTime       : this.upTime,
            remainingTime: this.remainingTime,
            started      : this.startTime > 0,
            ended        : this.endTime > 0,
            error        : this.error
        };
    }
}

module.exports = Task;
