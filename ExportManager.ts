import crypto                                    from "crypto"
import moment                                    from "moment"
import fs                                        from "fs"
import zlib                                      from "zlib"
import { NextFunction, Request, Response }       from "express"
import { OperationOutcome, ParametersParameter } from "fhir/r4"
import config                                    from "./config"
import * as lib                                  from "./lib";
import QueryBuilder                              from "./QueryBuilder"
import getDB                                     from "./db"
import toNdjson                                  from "./transforms/dbRowToNdjson"
import toCSV                                     from "./transforms/dbRowToCSV"
import translator                                from "./transforms/dbRowTranslator"
import prependFileHeader                         from "./transforms/prependFileHeader"
import FhirStream                                from "./FhirStream"
import { ExportManifest, RequestWithSim }        from "./types"
import { ScopeList }                             from "./scope"
import { Manifest }                              from "./Manifest"

const supportedFormats = {
    "application/fhir+ndjson" : "ndjson",
    "application/ndjson"      : "ndjson",
    "ndjson"                  : "ndjson",
    "text/csv"                : "csv",
    "csv"                     : "csv"
};

const exportTypes = {
    ndjson: {
        fileExtension : "ndjson",
        contentType   : "application/fhir+ndjson",
        transform     : toNdjson
    },
    csv: {
        fileExtension : "csv",
        contentType   : "text/csv; charset=UTF-8; header=present",
        transform     : toCSV
    }
};

function getExportParam(req: Request, name: string)
{
    if (req.method == "GET") {
        return req.query[name];
    }
    
    if (req.method == "POST") {
        const out: any[] = [];
        (req.body.parameter || []).forEach((x: ParametersParameter) => {
            if (x.name === name) {
                const valueX = Object.keys(x).find(key => key.startsWith("value"));
                if (valueX) {
                    // @ts-ignore
                    out.push(x[valueX]);
                }
            }
        });

        if (out.length) {
            return out.length === 1 ? out[0] : out;
        }
    }

    return null;
}

function isFile(path: string)
{
    try {
        const stat = fs.statSync(path);
        return stat.isFile();
    } catch {
        return false;
    }
}

function deleteFileIfExists(path: string)
{
    try {
        if (isFile(path)) {
            fs.unlinkSync(path);
        }
    } catch (ex) {
        console.error(ex);
        return false;
    }
    return true;
}

const ABORT_CONTROLLERS = new Map();

/**
 * Map of organizeOutputBy parameters and their corresponding DB columns to
 * stratify by
 */
const SUPPORTED_ORGANIZE_BY_TYPES = {
    ""       : "fhir_type",
    "Patient": "patient_id",
    "Group"  : "group_id"
}

interface JobState {
    createdAt               : number
    simulatedError         ?: string
    simulatedExportDuration?: number
    databaseMultiplier     ?: number
    stu                    ?: number
    resourcesPerFile       ?: number
    accessTokenLifeTime    ?: number
    resourceTypes          ?: string[]
    fhirElements           ?: string[]
    id                     ?: string
    requestStart           ?: number
    secure                 ?: boolean
    outputFormat           ?: string
    group                  ?: string
    request                ?: string
    since                  ?: string
    systemLevel            ?: boolean
    patients               ?: string[]
    fileError              ?: string
    jobStatus              ?: string
    extended               ?: boolean
    ignoreTransientError   ?: boolean
    simulateDeletedPct     ?: number
    kickoffErrors          ?: OperationOutcome[]
    typeFilter             ?: string
    progress               ?: number
    statusMessage          ?: string
    manifest               ?: ExportManifest
    tooManyFiles           ?: boolean
    organizeOutputBy       ?: keyof typeof SUPPORTED_ORGANIZE_BY_TYPES
    allowPartialManifests  ?: boolean
};

class ExportManager
{
    /**
     * Simulated error (if any)
     */
    simulatedError = "";

    /**
     * Simulated export duration
     */
    simulatedExportDuration = 10;

    /**
     * Database size multiplier
     */
    databaseMultiplier = 1;

    /**
     * FHIR version as integer (2|3|4)
     */
    stu = 4;

    /**
     * How many FHIR resources to include in one file
     */
    resourcesPerFile = config.defaultPageSize;

    /**
     * Access Token LifeTime in minutes
     */
    accessTokenLifeTime = config.defaultTokenLifeTime;

    /**
     * An array of resourceTypes (from the _type parameter)
     */
    resourceTypes: string[] = [];

    /**
     * An array of FHIR element paths (from the _elements parameter)
     */
    fhirElements: string[] = [];

    /**
     * Unique ID for this job
     */
    id: string = "";

    /**
     * When was the export started? JS timestamp.
     */
    requestStart: number = 0;

    /**
     * True if an authorization header has been passed to kick-off
     */
    secure: boolean = false;

    /**
     * File extension (ndjson|csv). Based on the _outputFormat parameter.
     */
    outputFormat: keyof typeof exportTypes = "ndjson";

    /**
     * The group ID (if any)
     */
    group: string = "";

    /**
     * The kick-off request URL
     */
    request: string = "";

    /**
     * The modified since FHIR instant (the _since parameter)
     */
    since: string = "";

    /**
     * The _typeFilter parameter
     */
    typeFilter: URLSearchParams = new URLSearchParams();

    /**
     * true for system-level exports and false otherwise
     */
    systemLevel: boolean = false;

    /**
     * Array of patient IDs to filter by (from the patient parameter)
     */
    patients: string[] = [];

    /**
     * Generated file download error (if any)
     */
    fileError: string = "";

    /**
     * The status of this job
     */
    jobStatus = "UNDEFINED";

    /**
     * When a _since timestamp is supplied in the export request, a portion of
     * the resources (expressed as percentage here) will be reported as deleted
     * using the deleted field in the output JSON.
     */
    simulateDeletedPct = 0;

    extended = false;

    /**
     * An array to hold kickoff errors that should be included in the errors
     * payload property if lenient handling is preferred
     */
    kickoffErrors: OperationOutcome[] = [];

    /**
     * Percent complete (0 to 100)
     */
    progress = 0;

    statusMessage = "Please wait...";

    manifest?: ExportManifest;

    tooManyFiles = false;

    createdAt: number = 0;

    ignoreTransientError?: boolean;

    organizeOutputBy: keyof typeof SUPPORTED_ORGANIZE_BY_TYPES = "";

    allowPartialManifests = true

    getAbortController() {
        let ctl = ABORT_CONTROLLERS.get(this.id)
        if (!ctl) {
            ctl = new AbortController()
            ABORT_CONTROLLERS.set(this.id, ctl)
        }
        return ctl
    }

    static createKickOffHandler(system = false)
    {
        return function(req: Request, res: Response) {
            const sim = (req as RequestWithSim).sim
            ExportManager.create(
                {
                    simulatedError         : sim.err,
                    simulatedExportDuration: sim.dur,
                    databaseMultiplier     : sim.m,
                    stu                    : sim.stu,
                    resourcesPerFile       : sim.page,
                    accessTokenLifeTime    : sim.tlt,
                    fileError              : sim.fileError,
                    simulateDeletedPct     : sim.del
                }
            ).then(
                job => job.kickOff(req, res, system),
                err => lib.operationOutcome(res, err.message, { httpCode: 400 })
            );
        }
    }

    static createCancelHandler()
    {
        return function cancelFlow(req: Request, res: Response) {
            return ExportManager.load(req.params.id)
                .then(job => job.cancel(res))
                .catch(() => lib.outcomes.cancelNotFound(res));
        };
    }

    static createStatusHandler()
    {
        return function handleStatus(req: Request, res: Response) {
            return ExportManager.load(req.params.id).then(
                job => job.handleStatus(req, res),
                (err: any) => {
                    if (err.code === "ENOENT") {
                        lib.operationOutcome(res, "The export was not found", { httpCode: 404 })
                    } else {
                        lib.operationOutcome(res, err.message, { httpCode: 400 })
                    }
                }
            );
        }
    };

    static createDownloadHandler()
    {
        return function handleFileDownload(req: Request, res: Response, next: NextFunction) {
            const sim = (req as RequestWithSim).sim
            ExportManager.load(sim.id).then(
                job => job.download(req, res).catch(next),
                () => lib.outcomes.exportDeleted(res)
            );
        }
    }

    static async cleanUp()
    {
        return lib.forEachFile({
            dir: config.jobsPath,
            filter: path => path.endsWith(".json")
        }, path => lib.readJSON<JobState>(path).then(state => {
            if (state && Date.now() - state.createdAt > config.maxExportAge * 60000) {
                return fs.promises.unlink(path);
            }
        })).then(() => {
            /* istanbul ignore if */
            if (process.env.NODE_ENV != "test") {
                setTimeout(ExportManager.cleanUp, 5000).unref();
            }
        });
    }

    // ========================================================================
    static async create(options: Partial<JobState>) {
        const instance = new ExportManager()
        instance.id = crypto.randomBytes(16).toString("hex");
        instance.createdAt = Date.now();
        instance.setOptions(options);
        await instance.save()
        return instance;
    }

    static async load(id: string) {
        const options = await lib.readJSON<JobState>(`${config.jobsPath}/${id}.json`);
        const instance = new ExportManager();
        instance.setOptions(options);
        return instance;
    }

    setOptions(options: Partial<JobState>) {
        this.kickoffErrors = options.kickoffErrors || [];

        this.setSimulatedError(options.simulatedError)
            .setSimulatedExportDuration(options.simulatedExportDuration)
            .setDatabaseMultiplier(options.databaseMultiplier)
            .setSTU(options.stu)
            .setResourcesPerFile(options.resourcesPerFile)
            .setAccessTokenLifeTime(options.accessTokenLifeTime)
            .setSystemLevel(options.systemLevel)
            .setGroup(options.group)
            // .setPatients(options.patients)
            .setSimulateDeletedPct(options.simulateDeletedPct)
            .setSince(options.since)
            .setTypeFilter(options.typeFilter)
            .setOrganizeOutputBy(options.organizeOutputBy);
        
        ["resourceTypes", "fhirElements", "id", "requestStart", "secure",
        "patients", "outputFormat", "request", "fileError","jobStatus",
        "extended", "createdAt", "ignoreTransientError", "progress",
        "statusMessage", "manifest", "tooManyFiles", "allowPartialManifests"]
        .forEach(key => {
            if (key in options) {
                // @ts-ignore
                this[key] = options[key];
            }
        });
    }

    // ========================================================================

    async save()
    {
        // DO NOT RE-CREATE THE FILE IF ALREADY ABORTED
        if (!ABORT_CONTROLLERS.has(this.id)) {
            return true;
        }

        const path = `${config.jobsPath}/${this.id}.json`;
        const unlock = await lib.lock(path)
        const data = JSON.stringify(this.toJSON(), null, 4);
        fs.writeFileSync(path, data, "utf8");
        await unlock();
        return true;
    }

    delete()
    {
        const path = `${config.jobsPath}/${this.id}.json`;
        this.getAbortController().abort();
        deleteFileIfExists(path);
        ABORT_CONTROLLERS.delete(this.id);
    }

    toJSON(): JobState
    {
        return {
            simulatedError         : this.simulatedError,
            simulatedExportDuration: this.simulatedExportDuration,
            databaseMultiplier     : this.databaseMultiplier,
            stu                    : this.stu,
            resourcesPerFile       : this.resourcesPerFile,
            accessTokenLifeTime    : this.accessTokenLifeTime,
            resourceTypes          : this.resourceTypes,
            fhirElements           : this.fhirElements,
            id                     : this.id,
            requestStart           : this.requestStart,
            secure                 : this.secure,
            outputFormat           : this.outputFormat,
            group                  : this.group,
            request                : this.request,
            since                  : this.since,
            systemLevel            : this.systemLevel,
            patients               : this.patients,
            fileError              : this.fileError,
            jobStatus              : this.jobStatus,
            extended               : this.extended,
            createdAt              : this.createdAt,
            ignoreTransientError   : this.ignoreTransientError,
            simulateDeletedPct     : this.simulateDeletedPct,
            kickoffErrors          : this.kickoffErrors,
            typeFilter             : this.typeFilter.toString(),
            progress               : this.progress,
            statusMessage          : this.statusMessage,
            manifest               : this.manifest,
            tooManyFiles           : this.tooManyFiles,
            organizeOutputBy       : this.organizeOutputBy,
            allowPartialManifests  : this.allowPartialManifests
        };
    }

    async kickOff(req: Request, res: Response, system: boolean)
    {
        const sim = (req as RequestWithSim).sim

        const isLenient = !!String(req.headers.prefer || "").match(/\bhandling\s*=\s*lenient\b/i);

        this.secure = !!req.headers.authorization;

        const grantedScopes = lib.getGrantedScopes(req)

        // Verify that the POST body contains a Parameters resource ------------
        if (req.method == "POST" && req.body.resourceType !== "Parameters") {
            return lib.operationOutcome(res, "The POST body should be a Parameters resource", { httpCode: 400 });
        }

        // Validate the accept header ------------------------------------------
        // let accept = req.headers.accept;
        // if (!accept || accept == "*/*") {
        //     accept = "application/fhir+ndjson"
        // }
        // if (accept != "application/fhir+ndjson" && accept != "application/fhir+json") {
        //     return lib.outcomes.invalidAccept(res, accept);
        // }

        // Simulate file_generation_failed error if requested ------------------
        if (this.simulatedError == "file_generation_failed") {
            return lib.outcomes.fileGenerationFailed(res);
        }

        try {
            this.setSTU(sim.stu);
        } catch (ex) {
            return lib.operationOutcome(res, (ex as Error).message, { httpCode: 400 });
        }

        this.setGroup(req.params.groupId);
        this.setSystemLevel(system);

        this.extended = !!sim.extended;

        const _type                  = getExportParam(req, "_type")         || "";
        const _patient               = getExportParam(req, "patient")       || "";
        const _since                 = getExportParam(req, "_since")        || "";
        const _outputFormat          = getExportParam(req, "_outputFormat") || "application/fhir+ndjson";
        const _elements              = getExportParam(req, "_elements")     || "";
        const _typeFilter            = getExportParam(req, "_typeFilter")   || "";
        const _includeAssociatedData = getExportParam(req, "_includeAssociatedData") || "";
        const _organizeOutputBy      = getExportParam(req, "organizeOutputBy") || "";

        if (_includeAssociatedData) {
            const outcome = lib.createOperationOutcome(`The "_includeAssociatedData" parameter is not supported by this server`);
            if (!isLenient) {
                this.delete();
                return res.status(400).json(outcome);
            }
            this.kickoffErrors.push(outcome);
        }

        if (_patient && req.method != "POST") {
            return lib.operationOutcome(res, `The "patient" parameter is only available in POST requests`, { httpCode: 400 });
        }

        try {
            this.setTypeFilter(_typeFilter)
        } catch (ex) {
            const outcome = lib.createOperationOutcome((ex as Error).message);
            if (!isLenient) {
                this.delete();
                return res.status(400).json(outcome);
            }
            this.kickoffErrors.push(outcome);
        }

        try {
            this.setOrganizeOutputBy(_organizeOutputBy)
        } catch (ex) {
            return lib.operationOutcome(res, (ex as Error).message, { httpCode: 400 });
        }

        try {
            await this.setResourceTypes(_type, grantedScopes);
        } catch (ex) {
            return lib.operationOutcome(res, (ex as Error).message, { httpCode: 400 });
        }

        try {
            this.setPatients(_patient);
        } catch (ex) {
            return lib.operationOutcome(res, (ex as Error).message, { httpCode: 400 });
        }

        try {
            this.setSince(_since);
        } catch (ex) {
            return lib.outcomes.invalidSinceParameter(res, _since);
        }

        try {
            await this.setFHIRElements(_elements);
        } catch (ex) {
            return lib.operationOutcome(res, (ex as Error).message, { httpCode: 400 });
        }

        if (!supportedFormats.hasOwnProperty(_outputFormat)) {
            return lib.operationOutcome(res, `The "${_outputFormat}" _outputFormat is not supported`, { httpCode: 400 });
        }
        this.outputFormat = supportedFormats[_outputFormat as keyof typeof supportedFormats] as keyof typeof exportTypes;

        this.allowPartialManifests = lib.bool(getExportParam(req, "allowPartialManifests"));

        this.requestStart = Date.now();

        const proto = req.headers["x-forwarded-proto"] || req.protocol;
        this.request = proto + "://" + req.headers.host + req.originalUrl;

        // Prepare the status URL
        let url = config.baseUrl + req.originalUrl.split("?").shift()!.replace(
            /(\/[^/]+)?\/fhir\/.*/,
            `/fhir/bulkstatus/${this.id}`
        );

        this.jobStatus = "STARTED";

        const abortSignal = this.getAbortController().signal;

        await this.save();

        lib.abortablePromise(this.buildManifest(abortSignal), abortSignal).catch(e => {
            if (!(e instanceof lib.AbortError)) {
                console.error(e)
            }
        });

        // Instead of generating the response, and then returning it, the server
        // returns a 202 Accepted header, and a Content-Location at which the
        // client can use to access the response.
        // HTTP/1.1 202 Accepted
        res.set("Content-Location", url);
        lib.outcomes.exportAccepted(res, url);
    }

    async stratify(): Promise<{ stratifier: string, rowCount: number }[]> {
        const builder = new QueryBuilder({
            type       : this.resourceTypes,
            patients   : this.patients,
            group      : this.group,
            systemLevel: this.systemLevel,
            start      : this.since,
            stratifier : SUPPORTED_ORGANIZE_BY_TYPES[this.organizeOutputBy] as any
        });
        const { sql, params } = builder.compileCount();
        const DB = getDB(this.stu);
        return DB.promise("all", sql, params);
    }

        const stream = new FhirStream({
            stu        : this.stu,
            databaseMultiplier: this.databaseMultiplier,
            extended   : this.extended,
            group      : this.group,
            since      : this.since,
            systemLevel: this.systemLevel,
            patients   : this.patients,
            offset     : 0,
            filter     : this.typeFilter.get("_filter"),
            stratifier : "fhir_type",
            limit
        });
    }

    async getCountsForResourceType(resourceType: string, limit: number): Promise<number> {
        return new Promise((resolve, reject) => {
            let input = this.getStreamForResource(resourceType, limit);
            input.init().then(() => {
                let count = 0;
                input.once("error", reject)
                input.once("close", () => resolve(count))
                input.on("data", () => { count += 1; })
            }, reject);
        });
    }

    async buildManifest(signal: AbortSignal) {

        const manifestInstance = new Manifest({
            jobId            : this.id,
            transactionTime  : moment(this.requestStart).format(),
            secure           : this.secure,
            request          : this.request,
            outputOrganizedBy: this.organizeOutputBy,
            outputFormat     : this.outputFormat
        })

        try {
            var resourceTypes = await lib.abortablePromise(this.stratify(), signal);
        } catch (e) {
            if (!(e instanceof lib.AbortError)) {
                console.error(e)
            }
            return null
        }

        const totalResourceCount = resourceTypes.reduce((prev, cur) => prev + cur.rowCount, 0) * this.databaseMultiplier;

        if (resourceTypes.length > 0) {
            for (const { stratifier, rowCount } of resourceTypes) {
                
                if (signal.aborted) {
                    return null;
                }

                this.statusMessage = `currently processing ${stratifier} resources`;
                await this.save()

                let resourceCount = rowCount * this.databaseMultiplier;
                let filteredCount = resourceCount;

                // If a filter is used we need to actually loop tru, filter and count how many
                // resources would remain after the filter
                if (this.typeFilter.get("_filter")) {
                    try {
                        filteredCount = await lib.abortablePromise<number>(this.getCountsForResourceType(stratifier, resourceCount), signal);
                    } catch (e) {
                        if (!(e instanceof lib.AbortError)) {
                            console.error(e)
                            return null
                        }
                    }
                }

                if (filteredCount > 0) {
                    const numFiles = Math.ceil(filteredCount / this.resourcesPerFile);
                    for (let i = 0; i < numFiles; i++) {

                        await lib.wait(config.statusThrottle)

                        // ~ half of the links might fail if such error is requested
                        if (this.simulatedError == "some_file_generation_failed" && i % 2) {
                            manifestInstance.addError(stratifier, `Failed to export ${i + 1}.${stratifier}.${this.outputFormat}`)
                        }

                        // Add normal download link
                        else {
                            let offset = this.resourcesPerFile * i;
                            let count = Math.min(this.resourcesPerFile, filteredCount - offset);
                            

                            // Here we know we have a list of {count} resources that
                            // we can put into a file by generating the proper link
                            // to it. However, if {this.simulateDeletedPct} is set,
                            // certain percentage of them should go into the
                            // "deleted" array instead!
                            if (this.simulateDeletedPct && this.since) {
                                let cnt = Math.round(count/100 * this.simulateDeletedPct);
                                if (cnt) {
                                    manifestInstance.addDeleted(
                                        stratifier,
                                        cnt,
                                        offset,
                                        Math.min(this.resourcesPerFile, Math.abs(filteredCount - offset))
                                    )
                                    count  -= cnt;
                                    offset += cnt;
                                }
                            }

                            manifestInstance.addFile(stratifier, count, offset, Math.max(Math.min(this.resourcesPerFile, filteredCount - offset), 0))
                        }

                        // Limit the manifest size based on total number of file links
                        if (manifestInstance.size() > config.maxFiles) {
                            this.tooManyFiles = true;
                            await this.save();
                            return null;
                        }
                    }
                }

                this.progress += (rowCount * this.databaseMultiplier / totalResourceCount * 100)
                // console.log(`Progress =======> ${this.progress}%`);
                await this.save()
            }
        } else {
            this.progress = 100
        }

        this.manifest = manifestInstance.toJSON()
        await this.save()
        return this.manifest
    }

    async handleStatus(req: Request, res: Response) {

        // Reject unauthorized
        if (this.secure && !req.headers.authorization) {
            return lib.operationOutcome(res, "Not authorized", { httpCode: 401 });
        }

        // Reject too many files
        if (this.tooManyFiles) {
            return res.status(413).send("Too many files");
        }

        // const signal = this.getAbortController().signal

        // Reject transient errors
        if (!this.ignoreTransientError && this.simulatedError == "transient_error") {
            this.ignoreTransientError = true;
            await this.save();
            return lib.operationOutcome(
                res,
                "An unknown error ocurred (transient_error). Please try again.",
                {
                    httpCode : 500,
                    issueCode: "transient"
                }
            );
        }

        // ensure requestStart param is present
        // let requestStart = moment(this.requestStart);

        // If waiting - show progress and exit
        if (this.typeFilter.get("_filter") || this.simulatedExportDuration <= 0) {
            if (Math.round(this.progress) < 100) {
                return res.set({
                    "X-Progress" : Math.round(this.progress) + "% complete, " + this.statusMessage,
                    "Retry-After": 1
                }).status(202).end();
            }
        } 
        else {
            // check if the user should (continue to) wait
            let requestStart = moment(this.requestStart);
            let endTime = moment(requestStart).add(this.simulatedExportDuration, "seconds");
            let now = moment();
        
            // If waiting - show progress and exit
            if (endTime.isAfter(now, "second")) {
                let diff = (+now - +requestStart)/1000;
                let pct = Math.round((diff / this.simulatedExportDuration) * 100);
                return res.set({
                    "X-Progress" : pct + "% complete, " + this.statusMessage,
                    "Retry-After": 2//Math.ceil(this.simulatedExportDuration - diff)
                }).status(202).end();
            }
        }

        

        if (!this.manifest) {
            return lib.operationOutcome(res, "Failed to build export manifest.", {
                httpCode : 400,
                // issueCode: "transient"
            });
        }

        res.set({
            "Expires": new Date(this.createdAt + config.maxExportAge * 60000).toUTCString()
        }).json(this.manifest);
    };

    async download(req: Request, res: Response)
    {
        const sim = (req as RequestWithSim).sim

        if (this.secure && !req.headers.authorization) {
            return lib.operationOutcome(res, "Not authorized", { httpCode: 401 });
        }

        // console.log(req.sim, this)
        const fileError = sim.fileError;

        // early exit in case simulated errors
        if (this.simulatedError == "file_expired") {
            return lib.outcomes.fileExpired(res);
        }

        // early exit in case simulated file errors
        if (fileError) {
            return res.set({ "Content-Type": "application/fhir+ndjson" })
                .end(JSON.stringify(lib.createOperationOutcome(sim.fileError!)));
        }

        const acceptEncoding = String(req.headers["accept-encoding"] || "");
        const shouldDeflate  = (/\bdeflate\b/.test(acceptEncoding));
        const shouldGzip     = (/\bgzip\b/.test(acceptEncoding));

        // set the response headers
        res.set({
            "Content-Type": exportTypes[this.outputFormat].contentType,
            "Content-Disposition": "attachment"
        });

        /* istanbul ignore else */
        if (shouldGzip) {
            res.set({ "Content-Encoding": "gzip" });
        }
        else if (shouldDeflate) {
            res.set({ "Content-Encoding": "deflate" });
        }

        const stratifier = SUPPORTED_ORGANIZE_BY_TYPES[this.organizeOutputBy] as any
        
        let input = new FhirStream({
            types      : this.organizeOutputBy ? [] : [req.params.file.split(".")[1]],
            stu        : this.stu,
            databaseMultiplier: this.databaseMultiplier,
            extended   : this.extended,
            group      : this.group,
            limit      : sim.limit,
            offset     : sim.offset,
            since      : this.since,
            systemLevel: this.systemLevel,
            patients   : this.patients,
            filter     : this.typeFilter.get("_filter"),
            stratifier
        });
        
        input.on("error", error => {
            console.error(error);
            return res.status(500).end();
        });

        input.init().then(() => {
            let pipeline = input.pipe(translator({
                _elements  : this.fhirElements,
                err        : this.fileError,
                deleted    : !!sim.del,
                secure     : this.secure
            }));

            // Prepend header row if needed
            if (this.organizeOutputBy) {
                pipeline = pipeline.pipe(prependFileHeader(this.organizeOutputBy))
            }

            const transform = exportTypes[this.outputFormat].transform;
            if (transform) {
                pipeline = pipeline.pipe(transform({ extended: this.extended }));
            }

            /* istanbul ignore else */
            if (shouldGzip) {
                pipeline = pipeline.pipe(zlib.createGzip())
            }
            else if (shouldDeflate) {
                pipeline = pipeline.pipe(zlib.createDeflate())
            } 

            pipeline.pipe(res);
        });
    }

    /**
     * After a bulk data request has been started, a client MAY send a DELETE
     * request to the URL provided in the Content-Location header to cancel the
     * request.
     * 
     * If the request has been completed, a server MAY use the request as a
     * signal that a client is done retrieving files and that it is safe for the
     * sever to remove those from storage.
     * 
     * Following the delete request, when subsequent requests are made to the
     * polling location, the server SHALL return a 404 error and an associated
     * FHIR OperationOutcome in JSON format. 
     */
    cancel(res: Response)
    {
        this.delete();
        return lib.outcomes.cancelAccepted(res);
    }

    // SETTERS
    // -------------------------------------------------------------------------

    setSimulatedError(errorId = "")
    {
        this.simulatedError = String(errorId || "").trim();
        return this;
    }

    /**
     * Sets the simulated file generation duration in seconds
     */
    setSimulatedExportDuration(duration = config.defaultWaitTime)
    {
        this.simulatedExportDuration = lib.uInt(duration, config.defaultWaitTime);
        return this;
    }

    /**
     * Sets the database size multiplier
     */
    setDatabaseMultiplier(multiplier = 1)
    {
        this.databaseMultiplier = lib.uInt(multiplier, 1);
        return this;
    }

    /**
     * Sets the numeric FHIR version
     */
    setSTU(version = 4)
    {
        const ver = lib.uInt(version, 4);
        if (ver < 2 || ver > 4) {
            throw new Error(`Invalid FHIR version "${version}". Must be 2, 3 or 4`);
        }
        this.stu = ver;
        return this;
    }

    setOrganizeOutputBy(organizeOutputBy = "")
    {
        if (!(organizeOutputBy in SUPPORTED_ORGANIZE_BY_TYPES)) {
            throw new Error("Unsupported organizeOutputBy parameter value");
        }
        this.organizeOutputBy = organizeOutputBy as keyof typeof SUPPORTED_ORGANIZE_BY_TYPES;
        return this;
    }

    /**
     * Sets the resourcesPerFile
     */
    setResourcesPerFile(count = config.defaultPageSize)
    {
        this.resourcesPerFile = lib.uInt(count, config.defaultPageSize);
        return this;
    }

    /**
     * Sets the Access Token LifeTime in minutes
     */
    setAccessTokenLifeTime(minutes = config.defaultTokenLifeTime)
    {
        this.accessTokenLifeTime = lib.uInt(minutes, config.defaultTokenLifeTime);
        return this;
    }

    /**
     * Set what percentage of the output resources should be reported as deleted
     */
    setSimulateDeletedPct(pct = 0)
    {
        this.simulateDeletedPct = lib.uInt(pct, 0);
        return this;
    }

    setSystemLevel(isSystemLevel?: boolean)
    {
        this.systemLevel = lib.bool(isSystemLevel);
        return this;
    }

    setGroup(groupId = "")
    {
        this.group = String(groupId || "").trim();
        return this;
    }

    /**
     * Sets the array of resource types to be exported
     * @param types Comma-separated list or array of strings
     */
    async setResourceTypes(types: string | string[], grantedScopes: ScopeList)
    {
        const availableTypes = await lib.getAvailableResourceTypes(this.stu);
        const requestedTypes = types ?
            lib.makeArray(types || "").map(t => String(t || "").trim()).filter(Boolean) :
            [...availableTypes];

        if (availableTypes.indexOf("OperationDefinition") === -1) {
            availableTypes.push("OperationDefinition");
        }

        const badParam = requestedTypes.find(type => availableTypes.indexOf(type) == -1);
        if (badParam) {
            this.resourceTypes = [];
            throw new Error(`The requested resource type "${badParam}" is not available on this server`);
        }

        if (this.secure) {
            const result = requestedTypes.filter(t => t === "OperationDefinition" || lib.canExportResourceType(t, grantedScopes));
            if (!result.length) {
                throw new Error("Could not authorize access to any resources");
            }
            this.resourceTypes = result;
        } else {
            this.resourceTypes = requestedTypes;
        }
    }

    setPatients(patients: {reference:string}[])
    {
        const arr = lib.makeArray(patients).filter(Boolean);
        if (this.systemLevel && arr.length) {
            throw new Error("The patient parameter is not available in system-level export requests");
        }

        this.patients = arr.map(ref => ref.reference ?
            ref.reference.replace(/^\/?Patient\//i, "") :
            null
        ).filter(Boolean);
        return this;
    }

    /**
     * Sets the _since moment and makes sure it is in the future
     * @param since FHIR Instant 
     */
    setSince(since = "")
    {
        this.since = since ? lib.fhirDateTime(since, true) : "";
        return this;
    }

    /**
     * Sets the _typeFilter parameter
     */
    setTypeFilter(_typeFilter = "")
    {
        this.typeFilter = new URLSearchParams(_typeFilter);
        return this;
    }

    async setFHIRElements(elements: string|string[])
    {
        const _elements = lib.makeArray(elements || "").map(t => String(t || "").trim()).filter(Boolean);
        const availableTypes = await lib.getAvailableResourceTypes(this.stu);
    
        for (let element of _elements) {
            const match = element.match(/^([a-zA-Z]+)(\.([a-zA-Z]+))?$/);
            if (!match || !match[1]) {
                throw new Error(`The _elements parameter should contain entries of the form "[element]" or "[ResourceType].[element]". Found "${element}".`);
            }
            if (match[3]) {
                const badParam = availableTypes.indexOf(match[1]) == -1;
                if (badParam) {
                    throw new Error(`The _elements parameter includes a resource type "${match[1]}" which is not available on this server.`);
                }
            }
        }
        this.fhirElements = _elements;
        return this;
    }
};

/* istanbul ignore if */
if (process.env.NODE_ENV != "test") {
    ExportManager.cleanUp();
}

export default ExportManager
