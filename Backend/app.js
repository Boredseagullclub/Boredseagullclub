require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const prom = require('prom-client');
const path = require('path');

const walletRoutes = require('./routes/walletRoutes');
const authRoutes = require('./routes/auth');
const logger = require('./utils/logger');
const { performFullAudit } = require('./reconciler');
const { runConfirmationCycle } = require('./services/ConfirmationEngine');
const { startXrplListener, getSyncStatus } = require('./xrplListener');
const { initSocket } = require('./services/socketService'); // assuming you have this

// ─── Prometheus Registry ────────────────────────────────────────────────
const register = new prom.Registry();
prom.collectDefaultMetrics({ register });

const passkeySuccessCounter = new prom.Counter({
  name: 'seagull_passkey_login_success_total',
  help: 'Total successful biometric logins',
  registers: [register],
});

const maintenanceGauge = new prom.Gauge({
  name: 'seagull_maintenance_mode',
  help: '1 if maintenance mode is enabled',
  registers: [register],
});

const xrplLagGauge = new prom.Gauge({
  name: 'seagull_xrpl_ledger_lag',
  help: 'Current XRPL ledger gap',
  registers: [register],
});

const lastAuditStatusGauge = new prom.Gauge({
  name: 'seagull_last_audit_status',
  help: '1 = SOLVENT, 0 = DEFICIT, -1 = FAILED or UNKNOWN',
  registers: [register],
});

let lastAuditStatus = 'UNKNOWN';
let lastAuditTime = null;

// ─── Critical Env Check ─────────────────────────────────────────────────
const criticalEnvVars = [
  'MONGO_URI',
  'XRP_HOT_WALLET_SEED',
  'XDC_HOT_WALLET_KEY',
  'FLR_HOT_WALLET_KEY',
  'XLM_HOT_WALLET_SECRET',
  'HBAR_HOT_WALLET_KEY',
  'ADMIN_SECRET',
  'JWT_SECRET',
  'RP_ID',
  'FRONTEND_URL', // for CORS and origin validation
];

criticalEnvVars.forEach(key => {
  if (!process.env[key]) {
    logger.fatal({ event: 'missing_critical_env', key });
    process.exit(1);
  }
});

let maintenanceMode = false;

// ─── App Setup ──────────────────────────────────────────────────────────
const app = express();
app.use(helmet());
app.use(cors({ 
  origin: process.env.FRONTEND_URL, 
  credentials: true // if using cookies/sessions later
}));
app.use(bodyParser.json());

// Mount routes with clear paths (prevents overwrite)
app.use('/api/wallet', walletRoutes);
app.use('/api/auth', authRoutes);

// Serve frontend static files (assuming build is in backend/client/build)
app.use(express.static(path.join(__dirname, 'client/build')));

// Admin auth middleware
const adminAuth = (req, res, next) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_SECRET) {
    logger.warn({ event: 'unauthorized_admin_attempt', ip: req.ip });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ─── Database & Services ────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    logger.info({ event: 'mongodb_connected' });

    // Initial audit
    try {
      const report = await performFullAudit();
      lastAuditStatus = report.overallStatus;
      lastAuditTime = new Date().toISOString();
      lastAuditStatusGauge.set(report.overallStatus === 'SOLVENT' ? 1 : 0);
      logger.info({ module: 'InitialAudit', status: report.overallStatus });
    } catch (err) {
      lastAuditStatus = 'FAILED';
      lastAuditStatusGauge.set(-1);
      logger.error({ module: 'InitialAudit', error: err.message });
    }

    // Hourly audit cron
    cron.schedule('0 * * * *', async () => {
      try {
        const report = await performFullAudit();
        lastAuditStatus = report.overallStatus;
        lastAuditTime = new Date().toISOString();
        lastAuditStatusGauge.set(report.overallStatus === 'SOLVENT' ? 1 : 0);
        if (report.overallStatus !== 'SOLVENT') {
          logger.warn({ module: 'AuditCron', status: report.overallStatus });
        }
      } catch (err) {
        lastAuditStatus = 'FAILED';
        lastAuditStatusGauge.set(-1);
        logger.error({ module: 'AuditCron', error: err.message });
      }
    });

    // Start XRPL listener
    await startXrplListener().catch(err => logger.error({ module: 'XRPL', error: err.message }));

    // Confirmation cycle
    setInterval(() => {
      if (maintenanceMode) return logger.info({ module: 'DepositEngine', event: 'cycle_skipped', reason: 'MAINTENANCE_MODE' });
      runConfirmationCycle().catch(err => logger.error({ module: 'DepositEngine', error: err.message }));
    }, 30000);

    logger.info({ event: 'all_services_online' });
  })
  .catch(err => {
    logger.fatal({ event: 'mongodb_connection_failed', error: err.message });
    process.exit(1);
  });

// ─── Health & Metrics ───────────────────────────────────────────────────
app.get('/health/status', (req, res) => {
  const status = getSyncStatus();
  xrplLagGauge.set(status.gap);
  maintenanceGauge.set(maintenanceMode ? 1 : 0);

  const isHealthy = status.processedLedger > 0 && status.gap < 20 && !maintenanceMode;
  res.status(isHealthy ? 200 : 503).json({
    timestamp: new Date().toISOString(),
    healthy: isHealthy,
    maintenance: maintenanceMode,
    xrpl: status,
    lastAudit: { status: lastAuditStatus, lastRun: lastAuditTime },
  });
});

app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});

// Admin endpoints
app.post('/admin/maintenance', adminAuth, (req, res) => {
  const { enabled } = req.body;
  maintenanceMode = !!enabled;
  maintenanceGauge.set(maintenanceMode ? 1 : 0);
  logger.info({ module: 'Admin', event: 'maintenance_mode_change', enabled: maintenanceMode });
  res.json({ success: true, maintenance: maintenanceMode });
});

app.post('/admin/audit', adminAuth, async (req, res) => {
  try {
    const report = await performFullAudit();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend SPA (catch-all for non-API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// ─── Start Server & Socket ──────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info({ event: 'server_listening', port: PORT });
});

// Initialize socket.io with the HTTP server
initSocket(server);

// ─── Graceful Shutdown ──────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  logger.info({ event: 'shutdown_initiated', signal });
  maintenanceMode = true;
  try {
    await Promise.race([
      mongoose.connection.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB Close Timeout')), 5000))
    ]);
    logger.info({ event: 'shutdown_complete' });
    process.exit(0);
  } catch (err) {
    logger.error({ event: 'shutdown_error', error: err.message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info({ event: 'server_listening', port: PORT });
});
