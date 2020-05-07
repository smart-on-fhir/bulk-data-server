

const { Readable } = require('stream');

/**
 * Mock up a readable stream. This is a real stream but we pass the entire
 * content (as string) to the constructor, and will the read it in chunks.
 */
class MockReadable extends Readable
{
    /**
     * @param {string} [input] 
     * @param {object} [options] 
     */
    constructor(input = "", options = {})
    {
        super(options);
        this.input = Buffer.from(input, "utf8");
        this.position = 0;
        this.total = Buffer.byteLength(this.input, "utf8");
    }

    _read(size)
    {
        const start = this.position;
        const end   = Math.min(this.position + size, this.total);

        if (start === this.total) {
            this.push(null);
        }
        else {
            const buff = Buffer.alloc(end - start);
            
            this.input.copy(buff, 0, start, end);
            this.position = end;
            this.push(buff);
        }
    }
}

module.exports = MockReadable;
