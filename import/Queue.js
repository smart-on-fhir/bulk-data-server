/**
 * Simple FIFO queue
 */
class Queue
{
    /**
     * The maximum size of the queue
     * @type {number}
     */
    #maxSize = 1000;

    /**
     * The items in the queue
     * @type {any[]}
     */
    #items;

    /**
     * Creates a queue from the given arguments. There are two ways to use this:
     * 1. From Array:     `new Queue([a, b, c])`
     * 2. From Arguments: `new Queue(a, b, c)`
     * @param  {...any|any[]} items 
     */
    constructor(...items)
    {
        if (items.length === 1 && Array.isArray(items[0])) {
            this.#items = [...items[0]];    
        } else {
            this.#items = items;
        }
    }

    /**
     * Set the maximum size of the queue
     * @param {number} size 
     */
    setMaxSize(size)
    {
        this.#maxSize = size;
    }

    /**
     * Adds one item to the queue
     * @param {*} item
     * @returns {Queue} Returns the instance
     * @throws {Error} Throws if there is no more space in the queue
     */
    enqueue(item)
    {
        if (this.#items.length >= this.#maxSize) {
            throw new Error(`Maximum queue size (${this.#maxSize}) reached`);
        }
        this.#items.push(item);
        return this;
    }

    /**
     * Removes and returns the first item in the queue.
     * Returns null if the queue is empty
     * @returns {any|null}
     */
    dequeue()
    {
        if (this.isEmpty()) {
            return null;
        }
        
        return this.#items.shift();
    }

    /**
     * Returns the size of the queue
     * @returns {number}
     */
    size()
    {
        return this.#items.length;
    }

    /**
     * Checks whether the queue is currently empty
     * @returns {boolean} 
     */
    isEmpty()
    {
        return this.#items.length === 0;
    }
}

module.exports = Queue;
