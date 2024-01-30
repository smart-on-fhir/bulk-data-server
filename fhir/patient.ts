import { Request, Response } from "express";
import { HumanName, Patient } from "fhir/r4";
import DB from "../db"
import {
    makeArray,
    getRequestedParams,
    operationOutcome
} from "../lib"


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

export default function(req: Request, res: Response) {
    const sim = getRequestedParams(req);
    let stu = sim.stu || 4;
    let params = [];
    let sql = 'SELECT resource_json FROM "data" WHERE fhir_type = "Patient"';

    if (req.query.group) {
        sql += " AND group_id = ?";
        params.push(req.query.group);
    }

    DB(stu).all(sql, params, (error: Error, rows: any[]) => {
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
