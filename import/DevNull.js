const { Writable } = require("stream");

class DevNull extends Writable
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

module.exports = DevNull;
