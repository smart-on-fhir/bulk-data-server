const { Transform } = require("stream");


class ResourceValidator extends Transform
{
    constructor(expectedType)
    {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this.expectedType = expectedType;
        this.num = 1;
    }

    _transform(resource, encoding, callback)
    {
        const resourceType = resource.resourceType;

        if (!resourceType) {
            return callback(new Error(
                `No resourceType found for resource number ${this.num}.`
            ));
        }

        if (!resource.id) {
            return callback(new Error(
                `No "id" found for resource number ${this.num}.`
            ));
        }

        if (this.expectedType !== resourceType) {
            return callback(new Error(
                `Invalid resourceType found for resource number ${this.num
                }. Expecting "${this.expectedType}".`
            ));
        }

        this.push(resource);
        this.num++;
        callback();
    }
}

module.exports = ResourceValidator;
