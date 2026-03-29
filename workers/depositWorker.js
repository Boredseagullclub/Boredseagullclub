const mongoose = require('mongoose');
const logger = require('../utils/logger');
const Deposit = require('../models/Deposit');
const { processDepositById } = require('../services/DepositProcessor');

async function startDepositWorker() {
  logger.info({ module: 'DepositWorker', event: 'start', mode: 'ChangeStream' });

  // 1. Create a "watch" on the Deposits collection
  // We only care about 'insert' operations where status is 'DETECTED'
  const depositStream = Deposit.watch([
    {
      $match: {
        operationType: 'insert',
        'fullDocument.status': 'DETECTED'
      }
    }
  ], { fullDocument: 'updateLookup' });

  depositStream.on('change', async (change) => {
    const depositId = change.fullDocument._id;
    
    try {
      logger.debug({ module: 'DepositWorker', event: 'job_received', depositId });
      
      // Pass the ID to your existing processor
      await processDepositById(depositId);
      
    } catch (err) {
      logger.error({
        module: 'DepositWorker',
        event: 'processing_failed',
        depositId,
        error: err.message
      });
    }
  });

  depositStream.on('error', (err) => {
    logger.fatal({ module: 'DepositWorker', event: 'stream_error', error: err.message });
    // Graceful restart logic
    setTimeout(startDepositWorker, 5000);
  });
}

// Self-healing: Also run a "Catch-Up" scan on boot 
// in case the worker was down while deposits came in.
async function catchUp() {
  const missed = await Deposit.find({ status: 'DETECTED' }).select('_id');
  for (const dep of missed) {
    await processDepositById(dep._id).catch(() => {});
  }
}

// ... keep your existing code above ...

// 🚀 BOOT SEQUENCE
const start = async () => {
  try {
    // Ensure we are connected to the DB (Docker environment uses MONGO_URI)
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI);
      logger.info({ module: 'DepositWorker', event: 'mongodb_connected' });
    }

    // 1. Run the catch-up first to handle missed deposits
    await catchUp();

    // 2. Start the real-time listener
    await startDepositWorker();

  } catch (err) {
    logger.fatal({ module: 'DepositWorker', event: 'bootstrap_failed', error: err.message });
    process.exit(1);
  }
};

// Execute the boot sequence
start();

module.exports = { startDepositWorker, catchUp }; // Still exported for testing
