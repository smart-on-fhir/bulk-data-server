import { Transform }     from "stream"
import { stringifyJSON } from "../lib"

export default function(options: { extended?: boolean } = {}) {
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: true,
        transform(row, _encoding, next) {
            stringifyJSON(options.extended ? row : row.resource_json)
                .then(json => this.push(json + "\n"))
                .then(() => next())
                .catch(next);
        }
    });
}

