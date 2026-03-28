// services/metrics.js

const prom = require('prom-client');

// Create a dedicated registry for the entire application
const register = new prom.Registry();

// Optional: Add default labels that will appear on all metrics
register.setDefaultLabels({
  app: 'seagullcash',        // or whatever your app name is
  environment: process.env.NODE_ENV || 'development'
});

// Collect Node.js default metrics (memory, CPU, event loop, etc.) — do this ONLY here
prom.collectDefaultMetrics({
  register,
  prefix: 'nodejs_'          // optional but recommended to avoid name clashes
});

// Example metric (you can add more here)
const passkeySuccessCounter = new prom.Counter({
  name: 'seagull_passkey_login_success_total',
  help: 'Total successful biometric / passkey logins',
  registers: [register],
  // labelNames: ['method']   // add if you want labels later
});

// Export the registry (needed for /metrics endpoint)
// Also export individual metrics if other modules need direct access
module.exports = {
  register,
  passkeySuccessCounter,
  // Add more metrics here as you create them, e.g.:
  // stellarDepositsBuffered: ..., etc.
};
