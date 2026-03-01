// services/DepositService.js
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const { ethers } = require('ethers');

async function confirmDeposits() {
  const pending = await Deposit.find({ status: 'DETECTED' });

  for (const dep of pending) {
    try {
      const provider = new ethers.JsonRpcProvider(
        process.env[`${dep.chain}_RPC_URL`]
      );

      const receipt = await provider.getTransactionReceipt(dep.txHash);
      if (!receipt) continue;

      const confirmations = receipt.confirmations;

      if (confirmations >= 12) {

        dep.status = 'CONFIRMED';
        await dep.save();

        const user = await User.findOne({ publicAddress: dep.walletAddress });
        if (!user) continue;

        user.balances.set(
          dep.token,
          Number(user.balances.get(dep.token) || 0) + dep.amount
        );

        await user.save();

        dep.status = 'CREDITED';
        await dep.save();
      }

    } catch (err) {
      console.error('Deposit confirmation error:', err.message);
    }
  }
}

module.exports = { confirmDeposits };
