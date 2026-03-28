// services/metrics.js

const prom = require('prom-client');

// Create a dedicated registry for the entire application
const register = new prom.Registry();

// Optional: Add default labels that will appear on all metrics
register.setDefaultLabels({
  app: 'seagullcash',
  environment: process.env.NODE_ENV || 'development'
});

// Collect Node.js default metrics (memory, CPU, event loop, etc.) — do this ONLY here
prom.collectDefaultMetrics({
  register,
  prefix: 'nodejs_'
});

const passkeySuccessCounter = new prom.Counter({
  name: 'seagull_passkey_login_success_total',
  help: 'Total successful biometric / passkey logins',
  registers: [register],
});

const maintenanceGauge = new prom.Gauge({
  name: 'seagull_maintenance_mode',
  help: '1 if maintenance mode is enabled',
  registers: [register],
});

const xrplLagGauge = new prom.Gauge({
  name: 'seagull_xrpl_ledger_lag',
  help: 'Current XRPL ledger gap (processed vs network tip)',
  registers: [register],
});

const lastAuditStatusGauge = new prom.Gauge({
  name: 'seagull_last_audit_status',
  help: '1=SOLVENT, 0=DEFICIT, -1=FAILED/UNKNOWN',
  registers: [register],
});

module.exports = {
  register,
  passkeySuccessCounter,
  maintenanceGauge,
  xrplLagGauge,
  lastAuditStatusGauge,
};
