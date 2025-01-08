import { Request, Response }           from "express"
import { HumanName, Patient }          from "fhir/r4"
import DB                              from "../db"
import { assert, getGroupMembers, makeArray, operationOutcome, OperationOutcomeError } from "../lib"
import config from "../config";


function getPatientName(json: Patient) {
    if (!Array.isArray(json.name) || !json.name[0] || typeof json.name[0] != "object") {
        return "Unknown name";
    }

    let tokens: string[] = [];

    const name = json.name[0]!;
    
    ["prefix", "given", "family", "suffix"].forEach(key => {
        if (key in name) {
            tokens.push(makeArray(name[key as keyof HumanName]).join(" "));
        }
    });

    return tokens.join(" ") || json.name[0].text || "Unknown name";
}

export default async function(req: Request, res: Response) {
    let params = [];
    let sql = 'SELECT resource_json FROM "data" WHERE fhir_type = "Patient"';
    const db = DB()

    if (req.query.group) {
        if (String(req.query.group).startsWith("custom-")) {
            try {
                const groupRow = await db.promise("get", `SELECT "resource_json" FROM "data" WHERE "resource_id" = ?`, [req.query.group]);
                assert(groupRow, "Group not found", OperationOutcomeError, { httpCode: 404 })
                const resourceRows = await db.promise("all", `SELECT * FROM "data" WHERE "fhir_type" IN ('${config.patientCompartment.join("','")}')`)
                const patientIds = getGroupMembers(JSON.parse(groupRow.resource_json), resourceRows);
                sql += ` AND patient_id IN('${Array.from(patientIds).join("','")}')`;
            } catch (ex) {
                return operationOutcome(res, (ex as Error).message);
            }
        } else {
            sql += " AND group_id = ?";
            params.push(req.query.group);
        }
    }

    db.all(sql, params, (error: Error, rows: any[]) => {
        if (error) {
            console.error(error);
            return operationOutcome(res, "DB query error");
        }
        res.json(rows.map(row => {
            const json = JSON.parse(row.resource_json) as Patient;
            return {
                id  : json.id,
                name: getPatientName(json)
            }; 
        }));
    });
}
