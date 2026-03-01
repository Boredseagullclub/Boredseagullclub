const { ethers } = require('ethers');
const Deposit = require('./models/Deposit');
const User = require('./models/User');

async function startEvmListener(chain) {
  const provider = new ethers.JsonRpcProvider(process.env[`${chain}_RPC_URL`]);
  const bridgeAddress = process.env[`${chain}_BRIDGE_ADDRESS`];

  provider.on('block', async (blockNumber) => {
    const block = await provider.getBlock(blockNumber, true);

    for (const tx of block.transactions) {
      if (tx.to && tx.to.toLowerCase() === bridgeAddress.toLowerCase()) {

        const receipt = await provider.getTransactionReceipt(tx.hash);
        if (receipt.status !== 1) continue;

        const amount = ethers.formatEther(tx.value);

        await Deposit.create({
          walletAddress: tx.from,
          chain,
          token: 'SeagullCoin',
          txHash: { type: String, unique: true, required: true },
          amount,
          confirmations: 0
        });
      }
    }
  });
}
