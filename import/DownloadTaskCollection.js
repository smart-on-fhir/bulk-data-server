// const NDJSONStream = require("./NDJSONStream");
const Task         = require("./Task");
const DownloadTask = require("./DownloadTask");
const DevNull      = require("./DevNull");



class DownloadTaskCollection extends Task
{
    /**
     * @param {*[]} files 
     */
    constructor(files)
    {
        super();
        this.files = files;
        this.tasks = [];
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

