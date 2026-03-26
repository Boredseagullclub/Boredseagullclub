const { ethers } = require('ethers');

// Simple cache object to reuse providers
const providers = {};

module.exports = async function confirmEvm(dep) {
  const rpcUrl = process.env[`${dep.chain}_RPC_URL`];
  
  // Reuse existing provider or create new one
  if (!providers[dep.chain]) {
    providers[dep.chain] = new ethers.JsonRpcProvider(rpcUrl);
  }
  
  const provider = providers[dep.chain];

  try {
    const receipt = await provider.getTransactionReceipt(dep.txHash);
    if (!receipt) return { confirmed: false, confirmations: 0 };

    // In ethers v6, confirmations() is an async method
    const confCount = await receipt.confirmations();
    
    return {
        confirmed: confCount >= 12 && receipt.status === 1,
        confirmations: confCount
    };
  } catch (err) {
    // If the provider/node dies, clear cache so it retries fresh next time
    delete providers[dep.chain];
    return { confirmed: false, confirmations: 0 };
  }
};
