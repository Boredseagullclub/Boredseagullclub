// xrplQueue.js
class XRPLQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.delayMs = 300; // Small buffer between requests to prevent hitting IP limits
    }

    add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        const { task, resolve, reject } = this.queue.shift();
        try {
            const result = await task();
            resolve(result);
        } catch (err) {
            reject(err);
        } finally {
            await new Promise(r => setTimeout(r, this.delayMs));
            this.processing = false;
            this.processQueue();
        }
    }
}

const xrplQueue = new XRPLQueue();
module.exports = xrplQueue;
