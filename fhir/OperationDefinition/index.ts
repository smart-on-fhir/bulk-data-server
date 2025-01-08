import moment            from "moment"
import crypto            from "crypto"
import config            from "../../config"
import { Router }        from "express"
import PatientEverything from "./Patient--everything"
import GroupEverything   from "./Group-i-everything"
import ResourceCounts    from "./s-get-resource-counts"
import GroupExport       from "./GroupExport"
import PatientExport     from "./PatientExport"
import SystemExport      from "./SystemExport"

const entries = [
    PatientEverything,
    GroupEverything,
    ResourceCounts,
    GroupExport,
    PatientExport,
    SystemExport
];

const SERVER_START_TIME = moment().format("YYYY-MM-DD HH:mm:ss");

const router = Router({ mergeParams: true });


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

router.get("/Patient--everything"   , (req, res) => res.json(PatientEverything));
router.get("/Group-i-everything"    , (req, res) => res.json(GroupEverything  ));
router.get("/-s-get-resource-counts", (req, res) => res.json(ResourceCounts   ));
router.get("/GroupExport"           , (req, res) => res.json(GroupExport      ));
router.get("/PatientExport"         , (req, res) => res.json(PatientExport    ));
router.get("/SystemExport"          , (req, res) => res.json(SystemExport     ));

export default router
