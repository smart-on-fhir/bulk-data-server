const moment         = require("moment");
const Task           = require("./Task");
const DownloadTask   = require("./DownloadTask");
const DatabaseWriter = require("./DatabaseWriter");
const Queue          = require("./Queue");
const config         = require("../config");


class DownloadTaskCollection extends Task
{
    /**
     * @param {object} payload
     */
    constructor(payload)
    {
        super();
        this.files = payload.input.map(fileInfo => ({ ...fileInfo }));

        /**
         * @type DownloadTask[]
         */
        this.tasks = [];
    }

    toJSON()
    {
        return {
            // FHIR instant, required. NOTE: need to decide what time 
            // transactionTime represents.
            //
            // Implementor notes:
            // -----------------------------------------------------------------
            // An instant represent a moment and not a time interval (duration).
            // This means it can be either the transaction start time, or the
            // end time. That said, I think the end time makes more sense
            // because it represents the time after which the files are
            // available on the server. If this method is called early (before
            // the transaction is complete), the current time will be used.
            transactionTime: moment(this.endTime || Date.now()).format("YYYY-MM-DDTHH:mm:ss.sssZ"),

            // do we need more context?
            //
            // Implementor notes:
            // -----------------------------------------------------------------
            // This is implemented because it is part of the spec, but it has
            // zero value! It is a well-known kick off location and any specific
            // information is passed in the POST body, which is not represented
            // here. 
            request: `${config.baseUrl}/$import`,

            // All the files that we have successfully imported
            output: this.tasks.filter(t => t.endTime && !t.error).map(t => ({
                type: "OperationOutcome", // these correspond to the `t.options.type` input file,
                inputUrl: t.options.url,
                count: t.count,
                url: `${config.baseUrl}/outcome?httpCode=200&issueCode=processing&severity=information&message=` +
                    encodeURIComponent(`${t.count} ${t.options.type} resources imported successfully`)
            })),

            // All the files that we have failed to import
            error: this.tasks.filter(t => t.endTime && t.error).map(t => ({
                type: "OperationOutcome",
                inputUrl: t.options.url,
                count: t.count,
                url: `${config.baseUrl}/outcome?httpCode=500&issueCode=exception&severity=error&message=` +
                    encodeURIComponent(`${t.options.type} resources could not be imported. ${t.error}`)
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
    init(parallelTasks = config.maxParallelDownloads)
    {
        const onError = (task, error) => {
            task.end(error);
        };

        const queue = new Queue(this.files.map(fileInfo => {
            const task = new DownloadTask(fileInfo);
            this.tasks.push(task);

            // On error set the `error` property
            task.once("error", error => onError(task, error));

            return task;
        }));

        // A function to be called on any task completion
        const next = () => {
            const task = queue.dequeue();
            
            if (!task) {
                return Promise.resolve();
            }

            return task.init()
                .then(() => this.total += task.total)
                .catch(error => onError(task, error))
                .finally(next);
        };

        // Begin with the initial batch
        let batch = [];
        while (parallelTasks-- && !queue.isEmpty()) {
            batch.push(next());
        }

        return Promise.all(batch);
    }

    /**
     * Start all downloads in parallel
     */
    async start(parallelTasks = config.maxParallelDownloads)
    {
        this.startTime = Date.now();

        if (!this.tasks.length) {
            await this.init(config.maxParallelDownloads);
        }

        // Use all the tasks that are not errored or ended
        const realTasks = this.tasks.filter(t => !t.endTime && !t.error);

        return this.run(realTasks, parallelTasks);
    }

    /**
     * @param {DownloadTask[]} tasks All the tasks that must be executed
     * @param {number} parallelTasks How many tasks to run in parallel
     */
    run(tasks, parallelTasks = config.maxParallelDownloads)
    {
        // Create a queue of tasks
        const queue = new Queue(tasks);

        // A function to be called on any task completion
        const next = () => {
            // console.log(queue.size())
            const task = queue.dequeue();
            
            if (!task) {
                return Promise.resolve();
            }

            return task.start().then(async (stream) => {
                task.response.once("end", next);
                stream.pipe(new DatabaseWriter());
            });
        };

        // Begin with the initial batch
        let batch = [];
        while (parallelTasks-- && !queue.isEmpty()) {
            batch.push(next());
        }

        return Promise.all(batch);
    }

    /**
     * Redefine the position getter to return the sum of included task positions
     */
    get position()
    {
        const tasks = this.tasks.filter(t => !t.error);
        return tasks.map(t => t.position).reduce((prev, cur) => prev + cur, 0);
    }

    /**
     * The aggregate progress for all of the included tasks
     */
    get progress()
    {
        const tasks = this.tasks.filter(t => !t.error);
        if (!tasks.length) {
            return 1;
        }

        let position = 0;
        let total = 0;

        tasks.forEach(t => {
            position += Math.max(t.position, 0);
            total    += Math.max(t.total, 0);
        });

        if (!total || !position) {
            return 0;
        }

        return position / total;
    }
}

module.exports = DownloadTaskCollection;

