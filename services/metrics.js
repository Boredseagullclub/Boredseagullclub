const prom = require('prom-client');

const register = new prom.Registry();

const passkeySuccessCounter = new prom.Counter({
  name: 'seagull_passkey_login_success_total',
  help: 'Total successful biometric logins',
  registers: [register],
});

module.exports = {
  register,
  passkeySuccessCounter,
};
