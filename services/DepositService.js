const Deposit = require('../models/Deposit');
const User = require('../models/User');
const { ethers } = require('ethers');
const mongoose = require('mongoose');

async function confirmDeposits() {
  const pending = await Deposit.find({ status: 'DETECTED' });

  for (const dep of pending) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const provider = new ethers.JsonRpcProvider(process.env[`${dep.chain}_RPC_URL`]);
      const receipt = await provider.getTransactionReceipt(dep.txHash);
      
      if (!receipt || receipt.confirmations < 12) {
        await session.abortTransaction();
        continue; 
      }

      // 1. Update Deposit Status
      dep.status = 'CREDITED';
      dep.creditedAt = new Date();
      await dep.save({ session });

      // 2. Find User
      const user = await User.findOne({ publicAddress: dep.walletAddress }).session(session);
      if (!user) throw new Error('User not found');

      // 3. Update Balance SAFELY using BigInt strings
      const currentBalance = BigInt(user.balances.get(dep.token) || "0");
      const depositAmount = BigInt(dep.amount); // Ensure dep.amount is stored as a string or Decimal128
      
      user.balances.set(dep.token, (currentBalance + depositAmount).toString());
      await user.save({ session });

      // Commit both changes at once
      await session.commitTransaction();
      console.log(`Successfully credited ${dep.amount} to ${dep.walletAddress}`);

    } catch (err) {
      await session.abortTransaction();
      console.error(`Failed to process deposit ${dep._id}:`, err.message);
    } finally {
      session.endSession();
    }
  }
}
