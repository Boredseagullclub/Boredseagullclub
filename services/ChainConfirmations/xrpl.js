const { Client } = require('xrpl');

module.exports = async function confirmXrpl(dep) {
  const client = new Client(process.env.XRPL_RPC_URL);
  await client.connect();

  const tx = await client.request({
    command: 'tx',
    transaction: dep.txHash
  });

  await client.disconnect();

  if (!tx.result.validated) return false;

  return true; // XRPL is final once validated
};
