const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const { processDepositById } = require('../services/DepositProcessor');

const connection = new IORedis(process.env.REDIS_URL);

const worker = new Worker(
  'deposit-queue',
  async job => {
    const { depositId } = job.data;
    await processDepositById(depositId);
  },
  {
    connection,
    concurrency: 10
  }
);

worker.on('failed', (job, err) => {
  logger.error({
    module: 'DepositWorker',
    depositId: job?.data?.depositId,
    error: err.message
  });
});

module.exports = worker;
