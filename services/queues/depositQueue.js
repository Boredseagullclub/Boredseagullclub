const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL);

const depositQueue = new Queue('deposit-queue', { connection });

module.exports = depositQueue;
