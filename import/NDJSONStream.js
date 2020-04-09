const Transform = require("stream").Transform;
const config    = require("../config");

/**
 * This is a transform stream that takes parts of NDJSON file as Buffer chunks
 * and emits one JSON object for each line
 */
class NDJSONStream extends Transform
{
    constructor()
    {
        super({
            writableObjectMode: false,
            readableObjectMode: true
        });

        this._stringBuffer = "";
        this._line         = 0;
        this.bufferSize    = 0;
    }

    get count()
    {
        return this._line;
    }

    _transform(chunk, encoding, next)
    {
        // Convert the chunk buffer to string
        this._stringBuffer += chunk.toString("utf8");

        // Get the char length of the buffer
        this.bufferSize = this._stringBuffer.length;

        // Protect against very long lines (possibly bad files without EOLs).
        const max = config.ndjsonMaxLineLength;
        if (this.bufferSize > max) {
            this._stringBuffer = "";
            this.bufferSize   = 0;
            return next(new Error(
                `Buffer overflow. No EOL found in ${max} subsequent characters.`
            ));
        }

        // Find the position of the first EOL
        let eolPos = this._stringBuffer.search(/\n/);

        // The chunk might span over multiple lines
        while (eolPos > -1) {
            const jsonString  = this._stringBuffer.substring(0, eolPos);
            this._stringBuffer = this._stringBuffer.substring(eolPos + 1);
            this.bufferSize   = this._stringBuffer.length;
            this._line += 1;
            
            // If this is not an empty line!
            if (jsonString.length) {
                try {
                    const json = JSON.parse(jsonString);
                    this.push(json);
                } catch (error) {
                    this._stringBuffer = "";
                    this.bufferSize   = 0;
                    return next(new SyntaxError(
                        `Error parsing NDJSON on line ${this._line}: ${error.message}`
                    ));
                }
            }

            eolPos = this._stringBuffer.search(/\n/);
        }

        next();
    }

    /**
     * After we have consumed and transformed the entire input, the buffer may
     * still contain the last line so make sure we handle that as well
     * @param {function} next 
     */
    _flush(next)
    {
        try {
            if (this._stringBuffer) {
                const json = JSON.parse(this._stringBuffer);
                this._stringBuffer = "";
                this.push(json);
            }
            next();
        } catch (error) {
            next(new SyntaxError(
                `Error parsing NDJSON on line ${this._line + 1}: ${error.message}`
            ));
        }
    }
}

module.exports = NDJSONStream;
