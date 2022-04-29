import * as lib from "./lib"
import config   from "./config"

interface QueryBuilderOptions {
    columns    ?: string[]
    type       ?: string | string[]
    start      ?: string
    limit      ?: number
    offset     ?: number
    group      ?: string
    systemLevel?: boolean
    patients   ?: string | string[] | null
}

/**
 * Very simple SQL query builder. This is custom builder to ONLY handle the few
 * things we need!
 */
export default class QueryBuilder {

    /** 
     * The name of the table that we select from
     */
    private _table: string = "data";

    /** 
     * The columns to select from the table
     */
    private _columns: string[] = ["*"];

    /** 
     * The types of fhir resources to include in the output
     */
    private _fhirTypes: string[] = [];

    /** 
     * The oldest possible modified date of the included resources
     */
    private _startTime: string | null = null;

    /** 
     * The SQL limit
     */
    private _limit: number | null = null;

    /** 
     * The SQL offset
     */
    private _offset: number | null = null;

    /** 
     * In case we want to filter by group
     */
    private _groupId: string | null = null;

    /** 
     * If true the system level resources (like Group) are also considered
     */
    private _systemLevel = false;

    /** 
     * List of patient IDs
     */
    private _patients: string[] = [];
    
    constructor(options: QueryBuilderOptions = {}) {
        this.setOptions(options);
    }

    setOptions(options: QueryBuilderOptions) {
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
        let sql = "SELECT ";
        let params: Record<string, any> = {};
        let where = this.compileWhere();

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
        let where = this.compileWhere();
        let params: Record<string, any> = {};

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
        let params: Record<string, any> = {};
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

    setFhirTypes(types: string | string[] = []) {
        this._fhirTypes = lib.makeArray(types)
            .map(t => String(t || "").trim()).filter(Boolean);
    }

    setColumns(cols: string[] = []) {
        this._columns = lib.makeArray(cols).filter(Boolean).map(String);
    }

    setStartTime(dateTime: string) {
        this._startTime = lib.fhirDateTime(dateTime);
    }

    setLimit(n: number) {
        this._limit = lib.uInt(n, config.defaultPageSize);
    }

    setOffset(n: number) {
        this._offset = lib.uInt(n);
    }

    setGroupId(gId: string) {
        let id = String(gId).trim();
        if (id) {
            this._groupId = id;
        }
    }
}
