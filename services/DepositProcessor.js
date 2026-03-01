const Deposit = require('../models/Deposit');
const User = require('../models/User');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { chainConfirmations } = require('./ConfirmationEngine'); // import chains

async function processDepositById(depositId) {
  const dep = await Deposit.findById(depositId);
  if (!dep || dep.status !== 'DETECTED') return;

  // Wrap your existing transaction logic here
  // Reuse your current `processDeposit()` code but remove retries,
  // because BullMQ will retry jobs for you.
}

module.exports = { processDepositById };
