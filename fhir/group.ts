import { Bundle, BundleEntry, Group } from "fhir/r4"
import { Request, Response }          from "express"
import crypto                         from "crypto"
import moment                         from "moment"
import * as uuid                      from "uuid"
import DB                             from "../db"
import config                         from "../config"
import { validateQuery }              from "../typeFilter"
import {
    htmlEncode,
    getRequestedParams,
    operationOutcome,
    assert,
    OperationOutcomeError
} from "../lib"


interface Row {
    resource_json: string
    id: string
    quantity: number
}

const SERVER_START_TIME = moment().format("YYYY-MM-DD HH:mm:ss");

function deleteExpiredGroups() {
    DB()
    .promise(
        "run",
        `DELETE FROM "data" WHERE "fhir_type" = 'Group' AND "expires_at" <= ?`,
        new Date().toISOString()
    )
    .catch(console.error)
    .finally(() => setTimeout(deleteExpiredGroups, 360_000).unref());
}

deleteExpiredGroups()

class GroupResource
{
    json: Group = {
        resourceType: "Group",
        actual: true,
        type: "person",
        id: "",
        meta: {
            id: ""
        }
    };

    constructor(resource?: Partial<Group>) {
        if (resource) {
            this.set(resource)
        }
    }

    set(resource: Partial<Group>) {
        if (resource.id) {
            this.setId(resource.id)
        }
        return this
            .setMeta(resource.meta)
            .setName(resource.name)
            .setType(resource.type)
            .setActual(resource.actual)
            .setCharacteristic(resource.characteristic)
            .setMember(resource.member)
            .setModifierExtension(resource.modifierExtension)
            .setLastUpdated(new Date().toISOString())
    }

    setId(id: string) {
        this.json.id = id
        this.json.meta!.id = id
        return this
    }

    setLastUpdated(lastUpdated: string) {
        this.json.meta!.lastUpdated = lastUpdated
        return this
    }

    /**
     * If the request body includes a meta, the server SHALL ignore the existing
     * versionId and lastUpdated values. The server SHALL populate the id,
     * meta.versionId and meta.lastUpdated with the new correct values.
     */
    setMeta(meta: Group["meta"]) {
        Object.assign(this.json.meta!, meta, {
            id: this.json.id,
            versionId: "1",
            lastUpdated: this.json.meta!.lastUpdated
        })
        return this
    }

    /**
     * name (1..1)
     * A label assigned to the group for human identification and communication.
     */
    setName(name: Group["name"]) {
        assert(name, "A Group name is required", OperationOutcomeError)
        assert(typeof name === "string", "The Group name must be a string", OperationOutcomeError)
        this.json.name = name
        this.json.text = {
            div: `<div xmlns="http://www.w3.org/1999/xhtml">${htmlEncode(name)}</div>`,
            status: "generated"
        }
        return this
    }

    /**
     * type (1..1)
     * A client SHALL populate this element with person when creating a group of
     * Patients, or practitioner when creating a group of Practitioners.
     */
    setType(type?: Group["type"]) {
        assert(type, "A Group type is required", OperationOutcomeError)
        assert(type === "person", "Only 'person' type is supported for groups", OperationOutcomeError)
        this.json.type = type
        return this
    }

    /**
     * If true, indicates that the resource refers to a specific group of real
     * individuals. If false, the group defines a set of intended individuals.
     */
    setActual(actual?: Group["actual"]) {
        assert(actual !== false, "This server supports actual groups only", OperationOutcomeError)
        this.json.actual = true
        return this
    }

    /**
     * Identifies traits whose presence or absence is shared by members of the
     * group.
     */
    setCharacteristic(characteristic?: Group["characteristic"]) {
        assert(!characteristic, "The characteristic property of the Group must not be specified", OperationOutcomeError)
        return this
    }

    /**
     * member (0..*)
     * A server MAY support the inclusion of one or more member elements that
     * contain an entity element with a reference to a Patient resource,
     * Practitioner resource, or Group resource that is a group of Patient
     * resources or Practitioner resources.
     * 
     * When members are provided, the expression in the memberFilter extension
     * for the Group SHALL only be applied to the compartments of the referenced
     * resources, or those of the members of referenced Group resources.
     * 
     * When members are not provided and the Group's type element is set to
     * person, the expression in the memberFilter extension SHALL be applied to
     * all of the Patient compartments the client is authorized to access.
     * 
     * When members are not provided and the Group's type element is set to
     * practitioner, the expression in the memberFilter extension SHALL be
     * applied to all of the Practitioner compartments the client is authorized
     * to access.
     */
    setMember(member?: Group["member"]) {
        if (Array.isArray(member) && member.length) {
            this.json.member = member
        }
        return this
    }

    /**
     * memberFilter ModifierExtension (1..*)
     * 
     * A server SHALL support the inclusion of one or more memberFilter modifier
     * extensions containing a valueExpression with a language of
     * application/x-fhir-query and an expression populated with a FHIR REST API
     * query for a resource type included in the Patient or Practitioner
     * compartment. If multiple memberFilter extensions are provided that
     * contain criteria for different resource types, servers SHALL filter the
     * group to only include Patients or Practitioners that have resources in
     * their compartments that meet the conditions in all of the expressions.
     * If multiple memberFilter extensions are provided that contain criteria
     * for a single resource type, the server SHALL include Patients or
     * Practitioners who have resources in their compartments that meet the
     * criteria for that resource type in any of those expressions (a logical
     * "or"). A server MAY also support other expression languages such as
     * text/cql. When more than one language is supported by a server a client
     * SHALL use a single language type for all of the memberFilter expressions
     * included in a single Group.
     */
    setModifierExtension(modifierExtension?: Group["modifierExtension"]) {
        if (Array.isArray(modifierExtension) && modifierExtension.length) {
            this.json.modifierExtension = []
            for (const extension of modifierExtension) {
                if (extension.url.endsWith("/memberFilter") && extension.valueString) {
                    // Servers SHALL reject Group creation requests that include
                    // unsupported search parameters in a memberFilter expression
                    try {
                        validateQuery(extension.valueString, {
                            compartment: this.json.type === "person" ?
                                config.patientCompartment :
                                config.practitionerCompartment
                        })
                    } catch (ex) {
                        throw new Error(`Invalid memberFilter "${extension.valueString}". ${ex}`)
                    }
                    this.json.modifierExtension.push(extension)
                }
            }
        }
        return this
    }

    toJSON() {
        return this.json
    }
}

/**
 * Criteria based groups: Define Group resources based on a set of patient
 * characteristics. These characteristics are then used by the server to
 * associate members with the group. Examples would be a client that uses a
 * FHIR API to create a cohort of patients who are assigned to a specific
 * practitioner, or a cohort of patients with a problem list condition of
 * diabetes and a visit in the past month.
 * 
 * A group may represent a subset of another "read-only group" or
 * "member based group", and could be point in time snapshot based on membership
 * at the time of creation or dynamically update as new patients meet the
 * specified criteria.
 * 
 * Our data is read-only, thus it makes sense to optimize by linking the
 * patients when the group is created.
 * 
 * When the Bulk Cohort API is supported, the server SHALL accept FHIR Group
 * create requests that use the FHIR Asynchronous Interaction Request pattern
 * and provide a valid FHIR Group resource that complies with the Bulk Cohort
 * Group Profile. The server MAY subsequently make the new Group resource
 * available to authorized clients or MAY reject resource creation request
 * and returning a relevant error.
 * 
 * @request POST [base]/Group
 */
export async function create(req: Request, res: Response) {

    // The request body SHALL be a FHIR Resource. The resource does not need to
    // have an id element (this is one of the few cases where a resource exists
    // without an id element).
    const resource = req.body as Group

    assert(resource, "No resource submitted in request body")

    // Build the group to be created
    const resultGroup = new GroupResource(resource)
        .setId("custom-" + uuid.v4())
        .setLastUpdated(new Date().toISOString());

    const json = resultGroup.toJSON()

    await DB().promise("run", `INSERT INTO "data" (
            resource_id,
            resource_json,
            fhir_type,
            modified_date,
            group_id,
            patient_id,
            expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            json.id,
            JSON.stringify(json),
            "Group",
            json.meta!.lastUpdated,
            null,
            null,
            moment().add(config.customGroupsLifetimeDays, "days").toISOString()
        ]
    );

    return { body: json, status: 201 }
}

/**
 * The update interaction creates a new current version for an existing resource
 * or creates an initial version if no resource already exists for the given id.
 * The update interaction is performed by an HTTP PUT command
 */
export async function update(req: Request, res: Response)
{
    const { id } = req.params
    const resource = req.body as Group
    assert(resource, "No resource submitted in request body", OperationOutcomeError)
    assert(resource.id, "The resource id is missing", OperationOutcomeError)
    assert(resource.id === id, "The resource id is different from the id used in the url", OperationOutcomeError)

    // Build the group to be saved
    const resultGroup = new GroupResource(resource).setLastUpdated(new Date().toISOString())

    const json = resultGroup.toJSON()

    await DB().promise("run", `UPDATE "data" SET
        resource_json = ?,
        modified_date = ?,
        expires_at = ?
    WHERE fhir_type = 'Group' AND resource_id = ?`,
    [
        JSON.stringify(json),
        json.meta!.lastUpdated,
        moment().add(config.customGroupsLifetimeDays, "days").toISOString(),
        id
    ]);

    res.json(json)
}

export async function patch(req: Request, res: Response)
{
    const { id } = req.params
    const resource = req.body as Group
    assert(resource, "No resource submitted in request body", OperationOutcomeError)
    assert(resource.id, "The resource id is missing", OperationOutcomeError)
    assert(resource.id === id, "The resource id is different from the id used in the url", OperationOutcomeError)
    const rec = await DB().promise("get", `SELECT * FROM "data" WHERE "fhir_type" = 'Group' AND "resource_id" = ?`, id);
    assert(rec, "Group not found", OperationOutcomeError, { httpCode: 404 })

    // Build the group to be saved
    const resultGroup = new GroupResource({
        ...JSON.parse(rec.resource_json),
        ...resource
    }).setLastUpdated(new Date().toISOString())

    const json = resultGroup.toJSON()

    await DB().promise("run", `UPDATE "data" SET
        resource_json = ?,
        modified_date = ?,
        expires_at = ?
    WHERE fhir_type = 'Group' AND resource_id = ?`,
    [
        JSON.stringify(json),
        json.meta!.lastUpdated,
        moment().add(config.customGroupsLifetimeDays, "days").toISOString(),
        id
    ]);

    res.json(json)
}

export async function deleteOne(req: Request, res: Response) {
    const {id} = req.params
    const rec = await DB().promise("get", `SELECT * FROM "data" WHERE "fhir_type" = 'Group' AND "resource_id" = ?`, id);
    assert(rec, "Group not found", OperationOutcomeError, { httpCode: 404 })
    assert(id.startsWith("custom-"), "This is a read-only Group and cannot be deleted", OperationOutcomeError)
    await DB().promise("run", `DELETE FROM "data" WHERE "fhir_type" = 'Group' AND "resource_id" = ?`, id);
    operationOutcome(res, "Group deleted", { httpCode: 200, severity: "information" })
}

function resourceCreator(multiplier: number, sim?: string) {
    return function resource(group: Row) {
        const json = JSON.parse(group.resource_json) as Group;
        return {
            fullUrl: sim ? `${config.baseUrl}/${sim}/fhir/Group/${json.id}` : `${config.baseUrl}/fhir/Group/${json.id}`,
            resource: {
                resourceType: "Group",
                id: json.id,
                identifier: [
                    {
                        system: "https://bulk-data/db-id",
                        value : group.id
                    }
                ],
                quantity: group.quantity * multiplier,
                name: json.name,
                text: {
                    status: "generated",
                    div: `<div xmlns="http://www.w3.org/1999/xhtml">${htmlEncode(json.name!)}</div>`
                },
                type: "person",
                actual: true
            }
        };
    }
}

function bundle(items: Row[], multiplier: number, sim?: string) {
    const len = items.length;
    const bundle: Bundle = {
        "resourceType": "Bundle",
        "id"  : crypto.randomBytes(32).toString("hex"),
        "meta": {
            "lastUpdated": SERVER_START_TIME
        },
        "type": "searchset",
        "total": len,
        "link": [
            {
                "relation": "self",
                "url": sim ? `${config.baseUrl}/${sim}/fhir/Group` : `${config.baseUrl}/fhir/Group`
            }
        ]
    };

    if (len) {
        bundle.entry = items.map(resourceCreator(multiplier, sim)) as BundleEntry[];
    }

    return bundle;
}

export function getOne(req: Request, res: Response) {
    const {id} = req.params 
    const sim = getRequestedParams(req);
    let multiplier = sim.m || 1;

    DB().get(`SELECT "resource_json" FROM "data" WHERE "resource_id" = ?`, [id], (error: Error, row: Row) => {
        
        if (error) {
            console.error(error);
            return operationOutcome(res, "DB query error");
        }

        const json = JSON.parse(row.resource_json)

        res.json({ ...json, quantity: json.quantity * multiplier });
    })
}

export function getAll(req: Request, res: Response) {
    const sim = getRequestedParams(req);
    let multiplier = sim.m || 1;

    DB().all(
        `SELECT g.resource_json, g.resource_id AS id, COUNT(*) AS "quantity" FROM "data" as "g"
        LEFT JOIN "data" AS "d" ON (d.group_id = g.resource_id)
        WHERE g.fhir_type = "Group" AND d.fhir_type = "Patient"
        GROUP BY d.group_id`,
        (error: Error, rows: Row[]) => {
            if (error) {
                console.error(error);
                return operationOutcome(res, "DB query error");
            }
            res.json(bundle(rows, multiplier, req.params.sim));
        }
    );
}
