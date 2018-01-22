const crypto = require("crypto");
const moment = require("moment");
const DB     = require("../db");
const config = require("../config");
const lib    = require("../lib");

const SERVER_START_TIME = moment().format("YYYY-MM-DD HH:mm:ss");

function resourceCreator(multiplier) {
    return function resource(group) {
        
        return {
            resourceType: "Group",
            id: group.id,
            quantity: group.quantity * multiplier,
            name: group.name,
            text: {
                status: "generated",
                div: `<div xmlns="http://www.w3.org/1999/xhtml">${lib.htmlEncode(group.name)}</div>`
            },
            type: "person",
            actual: true
        };
    }
}

function bundle(items, multiplier) {
    const len = items.length;
    const bundle = {
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
                "url": `${config.baseUrl}/fhir/Group`
            }
        ]
    };

    if (len) {
        bundle.entry = items.map(resourceCreator(multiplier));
    }

    return bundle;
}

module.exports = (req, res) => {
    let multiplier = lib.getRequestedParams(req).m || 1;

    DB.all(
        `SELECT g.id, g.name, COUNT(*) AS "quantity"
        FROM "groups" AS "g"
        LEFT JOIN "data" AS "d" ON (d.group_id = g.id)
        WHERE d.fhir_type = "Patient"
        GROUP BY d.group_id`,
        (error, rows) => {
            if (error) {
                console.error(error);
                return lib.operationOutcome(res, "DB query error");
            }
            res.json(bundle(rows, multiplier));
        }
    );
};
