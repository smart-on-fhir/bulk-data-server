const DB     = require("../db");
const lib    = require("../lib");


function getPatientName(json)
{
    if (!Array.isArray(json.name) || !json.name[0] || typeof json.name[0] != "object") {
        return "Unknown name";
    }

    let tokens = [];

    ["prefix", "given", "family", "suffix"].forEach(key => {
        if (key in json.name[0]) {
            tokens.push(lib.makeArray(json.name[0][key]).join(" "));
        }
    });

    return tokens.join(" ") || json.name[0].text || "Unknown name";
}



module.exports = (req, res) => {
    const sim = lib.getRequestedParams(req);
    let stu = sim.stu || 4;
    let params = [];
    let sql = 'SELECT resource_json FROM "data" WHERE fhir_type = "Patient"';

    if (req.query.group) {
        sql += " AND group_id = ?";
        params.push(req.query.group);
    }

    DB(stu).all(sql, params, (error, rows) => {
        if (error) {
            console.error(error);
            return lib.operationOutcome(res, "DB query error");
        }
        res.json(rows.map(row => {
            const json = JSON.parse(row.resource_json);
            return {
                id  : json.id,
                name: getPatientName(json)
            }; 
        }));
    });
};
