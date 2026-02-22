const mongoose = require('mongoose');
const { SEAGULLCOIN, SEAGULLCASH, FEES } = require('./config');
const { verifySwapSignature } = require('./SignatureService');
const User = require('./models/User');
const Treasury = require('./models/Treasury');
const Pool = require('./models/Pool');
const Transaction = require('./models/Transaction');

// Blockchain SDKs
const { ethers } = require('ethers');
const rippleLib = require('ripple-lib');
const StellarSdk = require('stellar-sdk');
const { Client, PrivateKey, AccountId, TransferTransaction, Hbar } = require('@hashgraph/sdk');

const DAILY_BRIDGE_CAPS = {
  SeagullCoin: 100_000,
  SeagullCash: 250_000_000
};

const ALL_TOKENS = [
  ...Object.keys(SEAGULLCOIN),
  ...Object.keys(SEAGULLCASH)
];

function getFee(token) {
  if (SEAGULLCOIN[token]) return FEES.SEAGULLCOIN;
  if (SEAGULLCASH[token]) return FEES.SEAGULLCASH;
  return 0;
}

/**
 * On-chain settlement for different chains
 */
async function settleOnChain(walletAddress, token, amount, chain) {
  switch (chain.toUpperCase()) {
    case 'FLR':
    case 'XDC':
      // EVM chains
      {
        // Example placeholder for sending ERC20 token via ethers.js
        function getEvmProvider(chain) {
  switch (chain) {
    case 'FLR':
      return new ethers.JsonRpcProvider(process.env.FLARE_RPC_URL);

    case 'XDC':
      return new ethers.JsonRpcProvider(process.env.XDC_RPC_URL);

    default:
      throw new Error('Unsupported EVM chain');
  }
        }
        const provider = getEvmProvider(chain);
        const wallet = new ethers.Wallet(process.env.BRIDGE_PRIVATE_KEY, provider);
        const tokenContract = new ethers.Contract(
          token.contractAddress,
          token.abi,
          wallet
        );
        const tx = await tokenContract.transfer(walletAddress, ethers.parseUnits(amount.toString(), token.decimals));
        await tx.wait();
      }
      break;

    case 'XRPL':
      {
        // XRPL Payment
        const client = new rippleLib.Client(process.env.XRPL_RPC_URL);
        await client.connect();
        const prepared = await client.autofill({
          TransactionType: 'Payment',
          Account: process.env.BRIDGE_XRPL_ADDRESS,
          Amount: rippleLib.xrpToDrops(amount),
          Destination: walletAddress
        });
        const signed = client.sign(prepared, process.env.BRIDGE_XRPL_SECRET);
        await client.submitAndWait(signed.tx_blob);
        await client.disconnect();
      }
      break;

    case 'XLM':
      {
        // Stellar Payment
        const server = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL);
        const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.BRIDGE_STELLAR_SECRET);
        const account = await server.loadAccount(sourceKeypair.publicKey());
        const tx = new StellarSdk.TransactionBuilder(account, {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase: StellarSdk.Networks.TESTNET // replace with MAINNET in production
        })
          .addOperation(StellarSdk.Operation.payment({
            destination: walletAddress,
            asset: StellarSdk.Asset.native(),
            amount: amount.toString()
          }))
          .setTimeout(30)
          .build();
        tx.sign(sourceKeypair);
        await server.submitTransaction(tx);
      }
      break;

    case 'HBAR':
      {
        // Hedera HBAR transfer
        const client = Client.forTestnet(); // or Mainnet
        client.setOperator(process.env.BRIDGE_HBAR_ACCOUNT_ID, process.env.BRIDGE_HBAR_PRIVATE_KEY);
        const tx = new TransferTransaction()
          .addHbarTransfer(process.env.BRIDGE_HBAR_ACCOUNT_ID, Hbar.fromTinybars(-amount))
          .addHbarTransfer(walletAddress, Hbar.fromTinybars(amount));
        await tx.execute(client);
      }
      break;

    default:
      throw new Error(`Unsupported chain for settlement: ${chain}`);
  }
}

async function validateNonce(walletAddress, nonce, chain, session) {
  try {
    await Nonce.create([{ walletAddress, nonce, chain }], { session });
    // If insertion succeeds, nonce is new → valid
    return true;
  } catch (err) {
    if (err.code === 11000) {
      throw new Error('Nonce already used — possible replay attack');
    }
    throw err;
  }
}

async function executeSwap(walletAddress, fromToken, toToken, amount, nonce, signature, chain) {
  const parsedAmount = Number(amount);

  if (!walletAddress || !fromToken || !toToken || !chain)
    return { success: false, message: 'Missing parameters' };

  if (fromToken === toToken)
    return { success: false, message: 'Cannot swap same token' };

  if (!ALL_TOKENS.includes(fromToken) || !ALL_TOKENS.includes(toToken))
    return { success: false, message: 'Unsupported token' };

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return { success: false, message: 'Invalid amount' };

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findOne({ publicAddress: walletAddress }).session(session);
    if (!user) throw new Error('Wallet not found');

    // Check replay protection
    await validateNonce(walletAddress, nonce, chain, session);
   
    const currentBalance = Number(user.balances.get(fromToken) || 0);
    if (currentBalance < parsedAmount)
      throw new Error('Insufficient balance');

    const feePercent = getFee(fromToken);
    const fee = Number((parsedAmount * feePercent).toFixed(8));
    const amountAfterFee = Number((parsedAmount - fee).toFixed(8));

    const today = new Date().toISOString().split('T')[0];
    const usage = user.dailyBridgeUsage.get(fromToken);

    // Detect if AMM pool exists
    let pool = await Pool.findOne({
      $or: [
        { tokenA: fromToken, tokenB: toToken },
        { tokenA: toToken, tokenB: fromToken }
      ]
    }).session(session);

    const isBridgeSwap = !pool;

    let finalAmount;
    if (isBridgeSwap) {
      const usedToday = usage && usage.date === today ? usage.total : 0;
      if ((usedToday + parsedAmount) > (DAILY_BRIDGE_CAPS[fromToken] || Infinity))
        throw new Error(`Daily bridge cap reached for ${fromToken}`);

      user.dailyBridgeUsage.set(fromToken, {
        date: today,
        total: usedToday + parsedAmount
      });

      user.balances.set(fromToken, currentBalance - parsedAmount);
      user.balances.set(toToken, Number((user.balances.get(toToken) || 0) + amountAfterFee));
      finalAmount = amountAfterFee;
    } else {
      // AMM swap x*y=k
      const reserveIn = pool.tokenA === fromToken ? pool.reserveA : pool.reserveB;
      const reserveOut = pool.tokenA === fromToken ? pool.reserveB : pool.reserveA;
      const amountInWithFee = parsedAmount * (1 - feePercent);
      const amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);

      if (amountOut <= 0)
        throw new Error('AMM output too small');

      // Update pool reserves
      if (pool.tokenA === fromToken) {
        pool.reserveA += parsedAmount;
        pool.reserveB -= amountOut;
      } else {
        pool.reserveB += parsedAmount;
        pool.reserveA -= amountOut;
      }

      if (pool.reserveA <= 0 || pool.reserveB <= 0)
        throw new Error('Pool liquidity exhausted');

      await pool.save({ session });

      user.balances.set(fromToken, currentBalance - parsedAmount);
      user.balances.set(toToken, Number((user.balances.get(toToken) || 0) + amountOut));
      finalAmount = amountOut;
    }

    // **On-chain settlement**
    await settleOnChain(walletAddress, toToken, finalAmount, chain);

    // Treasury update
    await Treasury.findOneAndUpdate(
      { token: fromToken },
      { $inc: { collectedFees: fee } },
      { upsert: true, session }
    );

    await user.save({ session });

    await Transaction.create([{
      walletAddress,
      fromToken,
      toToken,
      amount: parsedAmount,
      received: finalAmount,
      fee,
      type: isBridgeSwap ? 'BRIDGE' : 'AMM',
      chain
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return {
      success: true,
      balances: Object.fromEntries(user.balances),
      fee
    };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return { success: false, message: err.message };
  }
}

module.exports = { executeSwap };
