import { Request, Response }  from "express"
import DB                     from "../db"
import { getRequestedParams } from "../lib"


export default function getResourceCounts(req: Request, res: Response) { // $get-resource-counts
    let sim = getRequestedParams(req);
    let multiplier = sim.m || 1;
    let stu = +(sim.stu || 3);
    DB(stu).all(
        `SELECT 
            fhir_type AS "resourceType",
            COUNT(*)  AS "resourcesCount"
        FROM "data"
        GROUP BY fhir_type`,
        (error: Error, rows: any[]) => {
            if (error) {
                return res.send(error);
            }
            res.json({
                "resourceType": "Parameters",
                "parameter": rows.map(r => ({
                    "name"        : r.resourceType,
                    "valueInteger": r.resourcesCount * multiplier
                }))
            });
        }
    );
}
