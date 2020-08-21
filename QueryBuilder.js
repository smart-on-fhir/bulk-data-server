const lib = require("./lib");
const config = require("./config");

/**
 * Very simple SQL query builder. This is custom builder to ONLY handle the few
 * things we need!
 */
class QueryBuilder {
    
    constructor(options = {}) {

        // The name of the table that we select from
        this._table = "data";

        // The columns to select from the table
        this._columns = ["*"];

        // The types of fhir resources to include in the output
        this._fhirTypes = [];

        // The oldest possible modified date of the included resources
        this._startTime = null;

        // The SQL limit
        this._limit = null;

        // The SQL offset
        this._offset = null;

        // In case we want to filter by group
        this._groupId = null;

        // If true the system level resources (like Group) are also considered
        this._systemLevel = false;

        // List of patient IDs
        this._patients = [];

        this.setOptions(options);
    }

    setOptions(options) {
        if (options.columns) {
            this.setColumns(options.columns);
        }
        if (options.type) {
            this.setFhirTypes(options.type);
        }
        if (options.start) {
            this.setStartTime(options.start);
        }
        if (options.limit) {
            this.setLimit(options.limit);
        }
        if (options.offset || options.offset === 0) {
            this.setOffset(options.offset);
        }
        if (options.group) {
            this.setGroupId(options.group);
        }
        if (options.systemLevel) {
            this._systemLevel = true;
        }
        if (Array.isArray(options.patients)) {
            this._patients = options.patients;
        }
    }

    compile() {
        let sql  = "SELECT ";
        let params = {};
        let where  = this.compileWhere();

        // TODO: validate, sanitize
        sql += this._columns.join(", ");

        sql += ` FROM "${this._table}"`;

        if (where.sql) {
            sql += " " + where.sql;
            params = Object.assign({}, params, where.params);
        }

        if (this._limit) {
            sql += ` LIMIT $_limit`;
            params.$_limit = this._limit;

            if (this._offset || this._offset === 0) {
                sql += ` OFFSET $_offset`;
                params.$_offset = this._offset;
            }
        }
        // console.log(" ======================== ");
        // console.log(sql, params);
        // console.log(" ======================== ");
        return { sql, params };
    }

    compileCount(countColumnAlias = "rowCount") {
        let sql = `SELECT "fhir_type", COUNT(*) as "${countColumnAlias}" FROM "data"`;
        let where  = this.compileWhere();
        let params = {};

        if (where.sql) {
            sql += " " + where.sql;
            params = Object.assign({}, params, where.params);
        }

        sql += ` GROUP BY "fhir_type"`;

        return { sql, params };
    }

    compileWhere() {
        let sql = "";
        let where = [];
        let params = {};
        let len = 0;
        
        if (this._fhirTypes.length) {
            len = where.push(`"fhir_type" IN("${this._fhirTypes.join('", "')}")`);
        }

        if (this._startTime) {
            len = where.push(`dateTime(modified_date) >= dateTime($_startTime)`);
            params.$_startTime = this._startTime;
        }

        if (this._groupId) {
            len = where.push(`group_id = $_groupId`);
            params.$_groupId = this._groupId;
        }

        if (!this._systemLevel) {
            if (this._patients.length) {
                len = where.push(`patient_id IN("${this._patients.join('", "')}")`);
            } else {
                len = where.push(`patient_id IS NOT NULL`);
            }
        }

        if (len) {
            sql = "WHERE " + where.join(" AND ");
        }

        return { sql, params };
    }

    setFhirTypes(types = []) {
        this._fhirTypes = lib.makeArray(types)
            .map(t => String(t || "").trim()).filter(Boolean);
    }

    setColumns(cols = []) {
        // TODO: validate, sanitize
        this._columns = lib.makeArray(cols).filter(Boolean).map(String);
    }

    setStartTime(dateTime) {
        this._startTime = lib.fhirDateTime(dateTime);
    }

    setLimit(n) {
        this._limit = lib.uInt(n, config.defaultPageSize);
    }

    setOffset(n) {
        this._offset = lib.uInt(n);
    }

    setGroupId(gId) {
        let id = String(gId).trim();
        if (id) {
            this._groupId = id;
        }
    }
}

module.exports = QueryBuilder;