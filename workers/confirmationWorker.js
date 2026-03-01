require('dotenv').config();
const mongoose = require('mongoose');
const { runConfirmationCycle } = require('../services/ConfirmationEngine');

mongoose.connect(process.env.MONGO_URI);

async function start() {
  while (true) {
    try {
      console.log('Running confirmation cycle...');
      await runConfirmationCycle();
    } catch (err) {
      console.error('Worker error:', err.message);
    }

    await new Promise(r => setTimeout(r, 10_000));
  }
}

start();
