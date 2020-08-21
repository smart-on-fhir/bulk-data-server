const Transform = require("stream").Transform;
const { stringifyJSON } = require("../lib");

module.exports = function(options = {}) {
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
};

