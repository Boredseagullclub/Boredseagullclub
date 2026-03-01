const { ethers } = require('ethers');

module.exports = async function confirmEvm(dep) {
  const provider = new ethers.JsonRpcProvider(
    process.env[`${dep.chain}_RPC_URL`]
  );

  const receipt = await provider.getTransactionReceipt(dep.txHash);
  if (!receipt) return false;

  return receipt.confirmations >= 12;
};
