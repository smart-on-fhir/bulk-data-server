const EventEmitter = require("events");
const crypto       = require("crypto");
const lib          = require("../lib");

class Task extends EventEmitter
{
    constructor(options = {})
    {
        super();

        /**
         * Any custom options passed to the constructor
         */
        this.options = { ...options };

        /**
         * Each task has an unique ID
         */
        this.id = crypto.randomBytes(32).toString("hex");

        /**
         * The time when the task has been started (or 0 if it is not started yet)
         * @type {number}
         * @protected
         */
        this._startTime = 0;

        /**
         * The time when the task was completed (or 0 if it is not complete yet)
         * @type {number}
         * @protected
         */
        this._endTime = 0;

        /**
         * The total value as number (how much needs to be done). For example,
         * for a download task this would be the total bytes that must be
         * downloaded.
         * @type {number}
         * @protected
         */
        this._total = 0;

        /**
         * The current position as number. For example, for a download task this
         * would be the the downloaded bytes.
         * @type {number}
         * @private
         */
        this._position = 0;
    }

    // Getters and Setters -----------------------------------------------------

    /**
     * Updates the current position (how much is done)
     * @param {number} val The value to set. Should be a positive integer
     * and will be converted to such if it isn't.
     * @protected
     */
    set position(val)
    {
        val = lib.uInt(val);

        const oldPosition = this._position;

        if (oldPosition === val) {
            return;
        }

        this._position = val;

        const info = this.toJSON();

        if (oldPosition === 0) {
            this.emit("start", info);
        }

        this.emit("progress", info);

        if (this._total && this._position / this._total >= 1) {
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
        return this._position;
    }

    /**
     * Sets the total value as number (how much needs to be done).
     * @param {number} val The value to set. Should be a positive integer
     * and will be converted to such if it isn't.
     * @protected
     */
    set total(val)
    {
        this._total = lib.uInt(val);
    }

    /**
     * Returns the total value as number (how much needs to be done)
     * @returns {number}
     * @public
     */
    get total()
    {
        return this._total;
    }

    get upTime()
    {
        if (!this._startTime) {
            return 0;
        }

        return (this._endTime || Date.now()) - this._startTime;
    }

    get progress()
    {
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
     * Marks the task as ended by setting the _endTime to the current timestamp
     */
    end()
    {
        if (!this._endTime) {
            this._endTime = Date.now();
            this.emit("end", this.toJSON());
        }
        return this;
    }

    /**
     * Represent the task as JSON, including some properties that are otherwise
     * private or invisible.
     */
    toJSON()
    {
        return {
            id           : this.id,
            position     : this._position,
            total        : this._total,
            progress     : this.progress,
            upTime       : this.upTime,
            remainingTime: this.remainingTime,
            started      : this._startTime > 0,
            ended        : this._endTime > 0
        };
    }
}

module.exports = Task;
