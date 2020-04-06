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

    init()
    {
        return Promise.all(
            this.files.map(fileInfo => {
                const task = new DownloadTask(fileInfo);
                this.tasks.push(task);
                return task.init().then(() => {
                    this.total += task.total;
                    return task;
                });
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

        return Promise.all(this.tasks.map(task => {
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

