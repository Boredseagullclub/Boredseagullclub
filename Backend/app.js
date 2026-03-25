require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const prom = require('prom-client');
const path = require('path');
const crypto = require('crypto');   // ← added for timingSafeEqual

const walletRoutes = require('./routes/walletRoutes');
const authRoutes = require('./routes/auth');
const logger = require('./utils/logger');
const { performFullAudit } = require('./reconciler');
const { runConfirmationCycle } = require('./services/ConfirmationEngine');
const { startXrplListener, getSyncStatus } = require('./xrplListener');
const { startStellarListener } = require('./stellarListener');
const { startHederaListener } = require('./hederaListener');
const { startEvmListeners } = require('./evmListener');
const { initSocket } = require('./socketService');

// ====================== Prometheus ======================
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
let maintenanceMode = false;
let server;   // For graceful shutdown

// ====================== Critical Env Check ======================
// Hot wallet keys are required for server-side withdrawals and bridging payouts.
// This makes outflows custodial (standard for most bridges), but deposits remain non-custodial.
// Daily limits in config.js + low hot-wallet balances keep risk low.
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
  'FRONTEND_URL',
  'PORT'
];

criticalEnvVars.forEach(key => {
  if (!process.env[key]) {
    logger.fatal({ event: 'missing_critical_env', key });
    process.exit(1);
  }
});

// ====================== App Setup ======================
const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ 
  origin: process.env.FRONTEND_URL, 
  credentials: true 
}));
app.use(bodyParser.json());

// Rate limiter for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use('/api/wallet', walletRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use(express.static(path.join(__dirname, 'client/build')));

// Admin middleware (Hardened: Timing-safe & Type-safe)
const adminAuth = (req, res, next) => {
  // Force to string to prevent Buffer errors if non-string is sent
  const providedKey = String(req.headers['x-admin-key'] || '');
  const expectedKey = String(process.env.ADMIN_SECRET || '');

  if (!providedKey || !expectedKey) {
    logger.warn({ event: 'unauthorized_admin_attempt', ip: req.ip, reason: 'missing_key' });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(expectedKey);

  // timingSafeEqual requires buffers of exact same length
  if (providedBuffer.length === expectedBuffer.length && 
      crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return next();
  }

  logger.warn({ event: 'unauthorized_admin_attempt', ip: req.ip });
  return res.status(401).json({ error: 'Unauthorized' });
};

  
// Health & metrics
app.get('/health/status', async (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  const status = getSyncStatus();
  
  xrplLagGauge.set(status.gap || 0);
  maintenanceGauge.set(maintenanceMode ? 1 : 0);

  const isHealthy = dbConnected 
    && !maintenanceMode 
    && status.processedLedger > 0 
    && status.gap < 30;

  res.status(isHealthy ? 200 : 503).json({
    healthy: isHealthy,
    dbConnected,
    maintenance: maintenanceMode,
    xrpl: status,
    lastAudit: { status: lastAuditStatus, lastRun: lastAuditTime },
  });
});

app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});

// Admin endpoints (now timing-safe)
app.post('/admin/maintenance', adminAuth, (req, res) => {
  maintenanceMode = !!req.body.enabled;
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

// SPA catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// ====================== Global Error Handler ======================
app.use((err, req, res, next) => {
  logger.error({ module: 'GlobalError', error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

// ====================== Boot Sequence ======================
const start = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info({ event: 'mongodb_connected' });

    // Blockchain listeners
    await startXrplListener();
    await startStellarListener();
    await startHederaListener();
    await startEvmListeners();

    // Background tasks — MongoDB only
    cron.schedule('0 * * * *', async () => {
      if (maintenanceMode) return;
      try {
        const r = await performFullAudit();
        lastAuditStatus = r.overallStatus;
        lastAuditStatusGauge.set(r.overallStatus === 'SOLVENT' ? 1 : 0);
        lastAuditTime = new Date();
      } catch (e) {
        logger.error({ module: 'AuditCron', error: e.message });
      }
    });

    setInterval(() => {
      if (!maintenanceMode) {
        runConfirmationCycle().catch(e => 
          logger.error({ module: 'DepositEngine', error: e.message })
        );
      }
    }, 10000);

    // Start server FIRST — health checks pass immediately
    server = app.listen(PORT, () => {
      logger.info({ event: 'server_listening', port: PORT });

      // Initial audit in background (non-blocking)
      performFullAudit().then(report => {
        lastAuditStatus = report.overallStatus;
        lastAuditStatusGauge.set(report.overallStatus === 'SOLVENT' ? 1 : 0);
        lastAuditTime = new Date();
        logger.info({ event: 'initial_audit_complete', status: lastAuditStatus });
      }).catch(e => {
        logger.error({ event: 'initial_audit_failed', error: e.message });
        lastAuditStatus = 'UNKNOWN';
        lastAuditStatusGauge.set(-1);
      });
    });

    initSocket(server);

    logger.info({ event: 'all_services_online' });
  } catch (err) {
    logger.fatal({ event: 'bootstrap_failed', error: err.message });
    process.exit(1);
  }
};

start();

// ====================== Graceful Shutdown ======================
const shutdown = async (signal) => {
  logger.info({ event: 'shutdown_initiated', signal });
  maintenanceMode = true;

  if (server) {
    server.close(() => {
      logger.info({ event: 'http_server_closed' });
    });
  }

  setTimeout(async () => {
    try {
      await mongoose.connection.close(false);
      logger.info({ event: 'mongodb_closed' });
    } catch (err) {
      logger.error({ event: 'mongodb_close_error', error: err.message });
    }

    logger.info({ event: 'shutdown_complete' });
    process.exit(0);
  }, 3000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandled_rejection', reason: reason.message || reason });
});
