const moment = require("moment");
const crypto = require("crypto");
const config = require("../../config");
const router = require("express").Router({ mergeParams: true });
const entries = [
    require("./Patient--everything"),
    require("./Group-i-everything"),
    require("./s-get-resource-counts")
];
const SERVER_START_TIME = moment().format("YYYY-MM-DD HH:mm:ss");


router.get("/", (req, res) => res.json({
    "resourceType": "Bundle",
    "id"  : crypto.randomBytes(32).toString("hex"),
    "meta": {
        "lastUpdated": SERVER_START_TIME
    },
    "type": "searchset",
    "total": entries.length,
    "link": [
        {
            "relation": "self",
            "url": `${config.baseUrl}/fhir/OperationDefinition`
        }
    ],
    entry: entries
}));

router.get("/Patient--everything"   , (req, res) => res.json(entries[0]));
router.get("/Group-i-everything"    , (req, res) => res.json(entries[1]));
router.get("/-s-get-resource-counts", (req, res) => res.json(entries[2]));

module.exports = router;
