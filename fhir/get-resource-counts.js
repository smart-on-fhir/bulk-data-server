const DB  = require("../db");
const Lib = require("../lib");

module.exports = (req, res) => { // $get-resource-counts
    let sim = Lib.getRequestedParams(req);
    let multiplier = sim.m || 1;
    let stu = +(sim.stu || 3);
    DB(stu).all(
        `SELECT 
            fhir_type AS "resourceType",
            COUNT(*)  AS "resourcesCount"
        FROM "data"
        GROUP BY fhir_type`,
        (error, rows) => {
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
};