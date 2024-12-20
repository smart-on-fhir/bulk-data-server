import { Bundle, BundleEntry, Group } from "fhir/r4"
import { Request, Response }          from "express"
import crypto                         from "crypto"
import moment                         from "moment"
import DB                             from "../db"
import config                         from "../config"
import {
    htmlEncode,
    getRequestedParams,
    operationOutcome
} from "../lib"


interface Row {
    resource_json: string
    id: string
    quantity: number
}

const SERVER_START_TIME = moment().format("YYYY-MM-DD HH:mm:ss");

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
        `SELECT g.resource_json, g.resource_id AS id, COUNT(*) AS "quantity"
        FROM "data" as "g"
        LEFT JOIN "data" AS "d" ON (d.group_id = g.resource_id)
        WHERE g.fhir_type = "Group"
        AND d.fhir_type = "Patient"
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
