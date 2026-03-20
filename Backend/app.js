require('dotenv').config(); 
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const walletRoutes = require('./routes/walletRoutes');
const logger = require('./utils/logger');
const { runConfirmationCycle } = require('./services/ConfirmationEngine');
const { startXrplListener, getSyncStatus } = require('./xrplListener');

// 🛡️ 1. THE GATEKEEPER
const criticalEnvVars = [
  'MONGO_URI',
  'XRP_HOT_WALLET_SEED',
  'XDC_HOT_WALLET_KEY',
  'FLR_HOT_WALLET_KEY',
  'XLM_HOT_WALLET_SECRET',
  'HBAR_HOT_WALLET_KEY'
];

criticalEnvVars.forEach(key => {
  if (!process.env[key]) {
    console.error(`\x1b[31m%s\x1b[0m`, `❌ FATAL: Missing environment variable: ${key}`);
    process.exit(1); 
  }
});

const app = express();
app.use(bodyParser.json());

// 2. Database & Service Start
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(async () => {
    console.log(`\x1b[36m%s\x1b[0m`, '📦 MongoDB Connected');

    // Start XRPL listener
    await startXrplListener().catch(err => 
      logger.error({ module: 'XRPL', error: err.message })
    );

    // Start confirmation worker
    setInterval(() => {
      runConfirmationCycle().catch(err =>
        logger.error({ module: 'DepositEngine', error: err.message })
      );
    }, 30000);

    console.log(`\x1b[32m%s\x1b[0m`, '🚀 All Seagull Services Online');
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// 3. Routes
app.use('/api', walletRoutes);

// 4. Health Check
app.get('/health/status', (req, res) => {
  const status = getSyncStatus();
  const isHealthy = status.processedLedger > 0 && status.gap < 20;

  res.status(isHealthy ? 200 : 503).json({
    timestamp: new Date().toISOString(),
    healthy: isHealthy,
    xrpl: status,
    limits: {
      SeagullCash: "25M/Day",
      SeagullCoin: "100k/Day"
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\x1b[35m%s\x1b[0m`, `📡 Server listening on Port ${PORT}`);
});

module.exports = { app };
