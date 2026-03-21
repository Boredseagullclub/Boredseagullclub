require('dotenv').config(); 
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const cron = require('node-cron');
const { performFullAudit } = require('./reconciler');

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

// 🛠️ MAINTENANCE TOGGLE
let maintenanceMode = false;

const app = express();
app.use(bodyParser.json());

// 🛡️ Admin Auth Middleware
const adminAuth = (req, res, next) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_SECRET) {
    logger.warn({ event: 'unauthorized_admin_attempt', ip: req.ip });
    return res.status(401).send('Unauthorized');
  }
  next();
};

// 2. Database & Service Start
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(async () => {
    console.log(`\x1b[36m%s\x1b[0m`, '📦 MongoDB Connected');

    // 🔍 INITIAL AUDIT ON BOOT
    performFullAudit()
      .then(report => logger.info({ module: 'InitialAudit', status: report.overallStatus }))
      .catch(err => logger.error({ module: 'InitialAudit', error: err.message }));

    // 🕒 SCHEDULED AUDIT (Every hour)
    cron.schedule('0 * * * *', async () => {
  try {
    const report = await performFullAudit();
    if (report.overallStatus !== 'SOLVENT') {
      logger.warn({ ... });
      // await sendCriticalAlert(`Audit deficit: ${JSON.stringify(report.criticalDeficits)}`);
    }
  } catch (err) {
    logger.error({ ... });
    // await sendCriticalAlert(`Audit CRASHED: ${err.message}`);
  }
});

    // Start XRPL listener
    await startXrplListener().catch(err => 
      logger.error({ module: 'XRPL', error: err.message })
    );

    // Start confirmation worker (Respects Maintenance Toggle)
    setInterval(() => {
      if (maintenanceMode) {
        return logger.info({ module: 'DepositEngine', event: 'cycle_skipped', reason: 'MAINTENANCE_MODE' });
      }

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

// 4. Health & Control
app.get('/health/status', (req, res) => {
  const status = getSyncStatus();
  const isHealthy = status.processedLedger > 0 && status.gap < 20 && !maintenanceMode;
  res.status(isHealthy ? 200 : 503).json({
    timestamp: new Date().toISOString(),
    healthy: isHealthy,
    maintenance: maintenanceMode,
    xrpl: status
  });
});

// 🛑 Private Maintenance Toggle
app.post('/admin/maintenance', adminAuth, (req, res) => {
  const { enabled } = req.body;
  maintenanceMode = !!enabled;
  logger.info({ module: 'Admin', event: 'maintenance_mode_change', enabled: maintenanceMode });
  res.json({ success: true, maintenance: maintenanceMode });
});

// 🔍 Manual Audit Trigger
app.post('/admin/audit', adminAuth, async (req, res) => {
  try {
    const report = await performFullAudit();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const gracefulShutdown = async (signal) => {
  logger.info({ event: 'shutdown_initiated', signal });
  // Close mongoose, listeners, etc.
  await mongoose.connection.close();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\x1b[35m%s\x1b[0m`, `📡 Server listening on Port ${PORT}`);
});
