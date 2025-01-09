import base64url                              from "base64-url"
import config                                 from "./config"
import * as lib                               from "./lib"
import { ExportManifest, ExportManifestFile } from "./types"


interface ManifestOptions {
    jobId : string
    secure: boolean
    outputFormat: string
    outputOrganizedBy: string
    transactionTime: string
    request: string
    outputPerPage: number
    _pages: [number, number, number, number, number, number][]
}

// When the allowPartialManifests kickoff parameter is true, the server MAY
// return a Content-Type header of application/json and a body containing an
// output manifest in the format described below, populated with a partial set
// of output files for the export.

// When provided, a manifest SHALL only contain files that are available for
// retrieval by the client.

// Once returned, the server SHALL NOT alter a manifest when it is returned in
// subsequent requests, with the exception of optionally adding a link field
// pointing to a manifest with additional output files or updating output file
// URLs that have expired.

// The output files referenced in the manifest SHALL NOT be altered once they
// have been included in a manifest that has been returned to a client.

export default class Manifest {

    transactionTime: ExportManifest["transactionTime"];

    request: ExportManifest["request"];

    requiresAccessToken: ExportManifest["requiresAccessToken"];

    deleted: ExportManifest["deleted"];

    output: ExportManifest["output"];

    error: ExportManifest["error"];

    outputOrganizedBy: ExportManifest["outputOrganizedBy"];

    jobId: string;

    outputFormat: string;

    outputOffset = 0

    deletedOffset = 0

    errorOffset = 0

    _pages: ManifestOptions["_pages"] = []

    outputPerPage = 0

    constructor(options: ManifestOptions) {
        this.jobId               = options.jobId
        this.outputFormat        = options.outputFormat
        this.transactionTime     = options.transactionTime
        this.request             = options.request
        this.requiresAccessToken = options.secure
        this.outputOrganizedBy   = options.outputOrganizedBy
        this._pages              = options._pages || []
        this.outputPerPage       = options.outputPerPage
        this.deleted             = [];
        this.output              = [];
        this.error               = [];
    }

    update(manifest: ExportManifest) {
        this.transactionTime     = manifest.transactionTime
        this.request             = manifest.request
        this.requiresAccessToken = manifest.requiresAccessToken
        this.outputOrganizedBy   = manifest.outputOrganizedBy
        this.deleted             = manifest.deleted
        this.output              = manifest.output
        this.error               = manifest.error
        this._pages              = manifest._pages || []
    }

    addError(entry: ExportManifestFile, fileError: string) {
        this.error.push({
            ...entry,
            type: "OperationOutcome",
            url : this.buildUrl({ fileError }, entry.url)
        });
    }

    addFile(entry: ExportManifestFile, sim: object) {
        const len = this.output.push({ ...entry, url: this.buildUrl(sim, entry.url) });
        if (len - this.outputOffset === this.outputPerPage) {
            this.savePage()
            return true
        }
        return false
    }

    addDeleted(fileName: string, limit: number, offset: number, count: number) {
        this.deleted!.push({
            type: "Bundle",
            count,
            url: this.buildUrl({ del: 1, limit, offset }, fileName)
        }); 
    }

    buildUrl(sim: object, fileName = "output") {
        return lib.buildUrlPath(
            config.baseUrl,
            base64url.encode(JSON.stringify({
                id    : this.jobId,
                secure: this.requiresAccessToken,
                ...sim
            })),
            `/fhir/bulkfiles/${fileName}`
        )
    }

    size() {
        return this.output.length + this.error.length + this.deleted!.length
    }

    toJSON(): ExportManifest {
        return {
            transactionTime    : this.transactionTime,
            request            : this.request,
            requiresAccessToken: this.requiresAccessToken,
            outputOrganizedBy  : this.outputOrganizedBy,
            deleted            : this.deleted,
            output             : this.output,
            error              : this.error,
            _pages             : this._pages
        }
    }

    savePage() {
        const index = this._pages.push([
            this.outputOffset , this.output.length,
            this.errorOffset  , this.error.length,
            this.deletedOffset, this.deleted?.length || 0
        ])
        
        this.outputOffset  = this.output.length
        this.errorOffset   = this.error.length
        this.deletedOffset = (this.deleted?.length || 0)
        
        return index
    }

    static getPage(jobId: string, manifest: ExportManifest, pageNumber = 1)
    {
        // Requested a page that is not ready yet
        if (pageNumber > manifest._pages.length) {
            return null
        }
    
        const page = manifest._pages[pageNumber - 1] || manifest._pages[0]
    
        if (!page) {
            return { ...manifest, _pages: undefined }
        }
    
        const [outputOffset, outputLimit, errorOffset, errorLimit, deletedOffset, deletedLimit] = page
        var out: any = {
            transactionTime    : manifest.transactionTime,
            request            : manifest.request,
            requiresAccessToken: manifest.requiresAccessToken,
            outputOrganizedBy  : manifest.outputOrganizedBy,
            deleted            : manifest.deleted?.slice(deletedOffset, deletedLimit),
            output             : manifest.output  .slice(outputOffset , outputLimit ),
            error              : manifest.error   .slice(errorOffset  , errorLimit  ),
        }
    
        if (pageNumber < manifest._pages.length + 1 && (
            manifest.output.length > outputLimit ||
            manifest.error.length  > errorLimit  ||
            (manifest.deleted?.length || 0) > deletedLimit)
         ) {
            out.link = [{
                relation: "next",
                url: lib.buildUrlPath(config.baseUrl, `/fhir/bulkstatus/${jobId}?page=${pageNumber+1}`)
            }]
        }
    
        return out
    }
}

