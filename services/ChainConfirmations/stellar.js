// services/ChainConfirmations/stellar.js

const StellarSdk = require('stellar-sdk');

module.exports = async function confirmStellar(dep) {
  const server = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL);

  try {
    const tx = await server.transactions().transaction(dep.txHash).call();

    // Must be successful and included in ledger
    if (!tx.successful) return false;

    return true; // Stellar is final once in ledger

  } catch (err) {
    // Not found yet
    return false;
  }
};
