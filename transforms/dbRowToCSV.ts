import { Transform } from "stream"

function csvEscape(value: string) {
    const type = typeof value;
    if (type == "number" || type == "boolean" || !value) {
        return String(value);
    }

    let out = String(value);
    if (type == "object") {
        out = JSON.stringify(value);
    }

    if (out.search(/"|,|\r|\n/) > -1) {
        return '"' + out.replace(/"/g, '""') + '"';
    }

    return out;
}

export default function(options: { extended?: boolean } = {}) {
    let _hasHeader = false;
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: true,
        transform(row, _encoding, next) {
            const obj = options.extended ? row : row.resource_json;
            let keys = Object.keys(obj);
            if (!_hasHeader) {
                this.push(keys.map(csvEscape).join(",") + "\r\n");
                _hasHeader = true;
            }

            try {
                this.push(keys.map(key => csvEscape(obj[key])).join(",") + "\r\n");
                setImmediate(next);
            } catch (error) {
                setImmediate(next, error as Error);
            }
        }
    });
}
