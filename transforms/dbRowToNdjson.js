const Transform = require("stream").Transform;

module.exports = function() {
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: true,
        transform(row, _encoding, next) {
            try {
                this.push(JSON.stringify(row.resource_json) + "\n");
                setImmediate(next);
            } catch (error) {
                setImmediate(next, error);
            }
        }
    });
};

