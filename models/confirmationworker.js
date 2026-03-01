const mongoose = require('mongoose');
const { confirmDeposits } = require('../services/DepositService');

mongoose.connect(process.env.MONGO_URI);

setInterval(async () => {
  console.log('Running confirmation worker...');
  await confirmDeposits();
}, 10_000); // every 10 seconds
