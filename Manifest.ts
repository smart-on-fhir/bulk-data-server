import base64url              from "base64-url"
import config                 from "./config"
import * as lib               from "./lib"
import { ExportManifest }     from "./types"


interface ManifestOptions {
    jobId : string
    secure: boolean
    outputFormat: string
    outputOrganizedBy: string
    transactionTime: string
    request: string
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

export class Manifest {

    transactionTime: ExportManifest["transactionTime"];

    request: ExportManifest["request"];

    requiresAccessToken: ExportManifest["requiresAccessToken"];

    deleted: ExportManifest["deleted"];

    output: ExportManifest["output"];

    error: ExportManifest["error"];

    outputOrganizedBy: ExportManifest["outputOrganizedBy"];

    jobId: string;

    outputFormat: string;

    constructor(options: ManifestOptions) {
        this.jobId               = options.jobId
        this.outputFormat        = options.outputFormat
        this.transactionTime     = options.transactionTime
        this.request             = options.request
        this.requiresAccessToken = options.secure
        this.outputOrganizedBy   = options.outputOrganizedBy
        this.deleted = [];
        this.output  = [];
        this.error   = [];
    }

    update(manifest: ExportManifest) {
        this.transactionTime     = manifest.transactionTime
        this.request             = manifest.request
        this.requiresAccessToken = manifest.requiresAccessToken
        this.outputOrganizedBy   = manifest.outputOrganizedBy
        this.deleted             = manifest.deleted
        this.output              = manifest.output
        this.error               = manifest.error
    }

    addError(resourceType: string, fileError: string) {
        this.error.push({
            type: "OperationOutcome",
            url : this.buildUrl(this.error.length, { fileError }, resourceType)
        });
    }

    addFile(resourceType: string, limit: number, offset: number, count: number) {
        this.output.push({
            type : resourceType,
            count,
            url  : this.buildUrl(this.output.length, { offset, limit }, resourceType)
        });
    }

    addDeleted(resourceType: string, limit: number, offset: number, count: number) {
        this.deleted!.push({
            type: "Bundle",
            count,
            url: this.buildUrl(this.deleted!.length, { del: 1, limit, offset }, resourceType)
        }); 
    }

    buildUrl(index: number, sim: object, fileName = "output") {
        return lib.buildUrlPath(
            config.baseUrl,
            base64url.encode(JSON.stringify({
                id    : this.jobId,
                secure: this.requiresAccessToken,
                ...sim
            })),
            "/fhir/bulkfiles/",
            `${index + 1}.${fileName}.${this.outputFormat}`
        )
    }

    size() {
        return this.output.length + this.error.length + this.deleted!.length
    }

    generateNextLink() {
        const outputOffset  = this.output.length
        const deletedOffset = this.deleted?.length || 0
        const errorOffset   = this.error.length
        return lib.buildUrlPath(
            config.baseUrl,
            base64url.encode(JSON.stringify({
                id    : this.jobId,
                secure: this.requiresAccessToken,
            })),
            `/bulkstatus/${this.jobId}?outputOffset=${outputOffset
            }&deletedOffset=${deletedOffset}&errorOffset=${errorOffset}`
        )
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
            link: [{
                relation: "next",
                url     : this.generateNextLink()
            }]
        }
    }

    getPage(options: {
        outputOffset : number
        outputLimit  : number
        deletedOffset: number
        deletedLimit : number
        errorOffset  : number
        errorLimit   : number
    }) {
        return {
            transactionTime    : this.transactionTime,
            request            : this.request,
            requiresAccessToken: this.requiresAccessToken,
            outputOrganizedBy  : this.outputOrganizedBy,
            deleted            : this.deleted?.slice(options.deletedOffset, options.deletedOffset + options.deletedLimit),
            output             : this.output  .slice(options.outputOffset , options.outputOffset  + options.outputLimit ),
            error              : this.error   .slice(options.errorOffset  , options.errorOffset   + options.errorLimit  ),
        }
    }

    extractPage(options: {
        outputOffset ?: number
        deletedOffset?: number
        errorOffset  ?: number
    } = {}) {
        return {
            transactionTime    : this.transactionTime,
            request            : this.request,
            requiresAccessToken: this.requiresAccessToken,
            outputOrganizedBy  : this.outputOrganizedBy,
            deleted            : this.deleted?.slice(options.deletedOffset || 0),
            output             : this.output  .slice(options.outputOffset  || 0),
            error              : this.error   .slice(options.errorOffset   || 0),
        }
    }
}
