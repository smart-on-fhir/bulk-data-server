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

        this._stingBuffer = "";
        this.line         = 0;
        this.bufferSize   = 0;
    }


    _transform(chunk, encoding, next)
    {
        // Convert the chunk buffer to string
        this._stingBuffer += chunk.toString("utf8");

        // Get the char length of the buffer
        this.bufferSize = this._stingBuffer.length;

        // Protect against very long lines (possibly bad files without EOLs).
        const max = config.ndjsonMaxLineLength;
        if (this.bufferSize > max) {
            this._stingBuffer = "";
            this.bufferSize   = 0;
            return next(new Error(
                `Buffer overflow. No EOL found in ${max} subsequent characters.`
            ));
        }

        // Find the position of the first EOL
        let eolPos = this._stingBuffer.search(/\n/);

        // The chunk might span over multiple lines
        while (eolPos > -1) {
            const jsonString  = this._stingBuffer.substring(0, eolPos);
            this._stingBuffer = this._stingBuffer.substring(eolPos + 1);
            this.bufferSize   = this._stingBuffer.length;
            this.line += 1;
            
            // If this is not an empty line!
            if (jsonString.length) {
                try {
                    const json = JSON.parse(jsonString);
                    this.push(json);
                } catch (error) {
                    this._stingBuffer = "";
                    this.bufferSize   = 0;
                    return next(new SyntaxError(
                        `Error parsing NDJSON on line ${this.line}: ${error.message}`
                    ));
                }
            }

            eolPos = this._stingBuffer.search(/\n/);
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
            if (this._stingBuffer) {
                const json = JSON.parse(this._stingBuffer);
                this._stingBuffer = "";
                this.push(json);
            }
            next();
        } catch (error) {
            next(new SyntaxError(
                `Error parsing NDJSON on line ${this.line + 1}: ${error.message}`
            ));
        }
    }
}

module.exports = NDJSONStream;
