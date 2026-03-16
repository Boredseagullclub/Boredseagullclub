const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const walletRoutes = require('./routes/walletRoutes');
const logger = require('./utils/logger');
const { runConfirmationCycle } = require('./services/ConfirmationEngine');
const { startXrplListener, getSyncStatus } = require('./xrplListener');


const app = express();
app.use(bodyParser.json());

/*
    MongoDB
*/
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/seagull', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('MongoDB connected');

  // Start deposit listeners after DB is ready
    startXrplListener().catch(console.error);

})
.catch(err => console.error('MongoDB connection error:', err));

/*
    API Routes
*/
app.use('/api', walletRoutes);


app.get('/health/xrpl', (req, res) => {
  const status = getSyncStatus();
  
  // Logical check: if we are more than 10 ledgers behind, 
  // or haven't seen a ledger yet, flag it as a warning.
  const isHealthy = status.processedLedger > 0 && status.gap < 10;

  res.status(isHealthy ? 200 : 503).json({
    timestamp: new Date().toISOString(),
    service: "XRPL_LISTENER",
    healthy: isHealthy,
    data: {
      current_bot_ledger: status.processedLedger,
      actual_network_ledger: status.networkLedger,
      ledger_lag: status.gap,
      pending_buffer: status.bufferSize,
      is_synced: status.isSynced
    }
  });
});


mongoose.connect(...)
.then(() => {
  console.log('MongoDB connected');
  // This now works because startXrplListener is the extracted function
  startXrplListener().catch(console.error); 
})


/*
    Deposit confirmation worker
*/
setInterval(() => {
  runConfirmationCycle()
    .catch(err => logger.error({ module: 'DepositEngine', error: err.message }));
}, 30000);

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Seagull Bridge running on port ${PORT}`);
});

module.exports = { app };
