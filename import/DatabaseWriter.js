const { Writable } = require("stream");

class DatabaseWriter extends Writable
{
    constructor()
    {
        super({ objectMode: true });
    }

    _write(chunk, encoding, callback)
    {
        callback();
    }
}

module.exports = DatabaseWriter;
