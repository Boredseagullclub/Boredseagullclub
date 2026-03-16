const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const walletRoutes = require('./routes/walletRoutes');
const logger = require('./utils/logger');
const { runConfirmationCycle } = require('./services/ConfirmationEngine');
const { startXrplListener, getSyncStatus } = require('./xrplListener');

const app = express();
app.use(bodyParser.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/seagull', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(async () => {
    console.log('MongoDB connected');

    // Start XRPL listener only after DB is ready
    await startXrplListener().catch(console.error);

    // Start confirmation worker
    setInterval(() => {
      runConfirmationCycle().catch(err =>
        logger.error({ module: 'DepositEngine', error: err.message })
      );
    }, 30000);
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api', walletRoutes);

// XRPL health check
app.get('/health/xrpl', (req, res) => {
  const status = getSyncStatus();

  const isHealthy = status.processedLedger > 0 && status.gap < 10;

  res.status(isHealthy ? 200 : 503).json({
    timestamp: new Date().toISOString(),
    service: 'XRPL_LISTENER',
    healthy: isHealthy,
    data: {
      current_bot_ledger: status.processedLedger,
      actual_network_ledger: status.networkLedger,
      ledger_lag: status.gap,
      pending_buffer: status.bufferSize,
      is_synced: status.isSynced,
    },
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Seagull Bridge running on port ${PORT}`);
});

module.exports = { app };
