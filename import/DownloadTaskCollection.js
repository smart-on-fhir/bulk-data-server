const moment       = require("moment");
const Task         = require("./Task");
const DownloadTask = require("./DownloadTask");
const DevNull      = require("./DevNull");



class DownloadTaskCollection extends Task
{
    /**
     * @param {object} payload
     */
    constructor(payload)
    {
        super();
        this.files = payload.input.map(fileInfo => ({ ...fileInfo }));
        this.tasks = [];
    }

    toJSON()
    {
        return {
            // FHIR instant, required. NOTE: need to decide what time 
            // ransactionTime represents.
            //
            // Implementor's notes
            // -----------------------------------------------------------------
            // An instant represent a moment and not a time interval (duration).
            // This means it can be either the transaction start time, or the
            // end time. That said, I think the end time makes more sense
            // because it represents the time after which the files are
            // available on the server. If this method is called early (before
            // the transaction is complete), the current time will be used.
            transactionTime: moment(this._endTime || Date.now()).format("YYYY-MM-DDTHH:mm:ss.sssZ"),

            "request": "TODO: [base]/$import", // do we need more context? 
            output: this.tasks.filter(t => t._endTime && !t.error).map(t => ({
                type: "OperationOutcome", // these correspond to the `t.options.type` input file,
                inputUrl: t.options.url,
                count: "TODO",
                url: "TODO" // optional link to the success results
            })),
            error: this.tasks.filter(t => t._endTime && t.error).map(t => ({
                type: "OperationOutcome", // these correspond to the `t.options.type` input file,
                inputUrl: t.options.url,
                count: "TODO",
                url: "TODO" // optional link to the success results
            }))
        };
    }

    /**
     * Makes the requests for each of the included tasks. Each response is
     * expected to return a "content-length" header which we use to compute the
     * `total` property of this task.
     * Note that some of these requests might fail early (e.g. 404). For that
     * reason we use `Promise.allSettled` instead of `Promise.all`.
     */
    init()
    {
        const onError = (task, error) => {
            // const index = this.tasks.findIndex(t => t === task);
            task.end(error);
        };

        // @ts-ignore
        return Promise.allSettled(
            this.files.map(fileInfo => {
                const task = new DownloadTask(fileInfo);
                this.tasks.push(task);

                // On error set the `error` property and remove this task from
                // the list
                task.once("error", error => onError(task, error));

                return task.init().then(() => this.total += task.total)
                    .catch(error => onError(task, error));
            })
        );
    }

    /**
     * Start all downloads in parallel
     */
    async start()
    {
        this._startTime = Date.now();

        if (!this.tasks.length) {
            await this.init();
        }

        // Use all the tasks that are not errored or ended
        const realTasks = this.tasks.filter(t => !t._endTime && !t.error);

        // Start all tasks and pipe them to dev/null for now
        return Promise.all(realTasks.map(task => {
            return task.start().then(stream => stream.pipe(new DevNull()));
        }));
    }

    /**
     * Redefine the position getter to return the sum of included task positions
     */
    get position()
    {
        return this.tasks.map(t => t.position).reduce((prev, cur) => prev + cur, 0);
    }
}

module.exports = DownloadTaskCollection;

