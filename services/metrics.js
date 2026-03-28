// services/metrics.js
const prom = require('prom-client');

// Dedicated registry for the entire application
const register = new prom.Registry();

// Default labels for all metrics (helps with multi-app Grafana dashboards)
register.setDefaultLabels({
  app: 'seagullcash',
  environment: process.env.NODE_ENV || 'development'
});

// Collect Node.js runtime metrics (CPU, memory, event loop, GC, etc.)
// → Do this ONLY once, in this central file
prom.collectDefaultMetrics({
  register,
  prefix: 'nodejs_'
});

// ── Application-specific metrics ─────────────────────────────────

const passkeySuccessCounter = new prom.Counter({
  name: 'seagull_passkey_login_success_total',
  help: 'Total number of successful biometric / passkey logins',
  registers: [register],
});

const maintenanceGauge = new prom.Gauge({
  name: 'seagull_maintenance_mode',
  help: '1 if maintenance mode is active, 0 otherwise',
  registers: [register],
});

const xrplLagGauge = new prom.Gauge({
  name: 'seagull_xrpl_ledger_lag',
  help: 'XRPL ledger gap (processed ledger index vs network tip)',
  registers: [register],
});

const lastAuditStatusGauge = new prom.Gauge({
  name: 'seagull_last_audit_status',
  help: 'Last solvency audit result: 1 = SOLVENT, 0 = DEFICIT, -1 = FAILED/UNKNOWN',
  registers: [register],
});

module.exports = {
  register,
  passkeySuccessCounter,
  maintenanceGauge,
  xrplLagGauge,
  lastAuditStatusGauge,
};
