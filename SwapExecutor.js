const { ethers } = require('ethers');
const { Client, Wallet, xrpToDrops } = require('xrpl');
const StellarSdk = require('stellar-sdk');
const { Client: HederaClient, TransferTransaction, Hbar } = require('@hashgraph/sdk');
const logger = require('../utils/logger');
const Withdrawal = require('../models/Withdrawal');

// ─────────────────────────────────────────────────────────────────────────────
// THE ACTUAL ON-CHAIN EXECUTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function executeOnChainPayout(withdrawalId) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal || withdrawal.status !== 'PROCESSING') return;

  try {
    let txHash;

    switch (withdrawal.chain.toUpperCase()) {
      case 'XDC':
      case 'FLR':
        txHash = await sendEvmPayout(withdrawal);
        break;
      case 'XRPL':
        txHash = await sendXrplPayout(withdrawal);
        break;
      case 'XLM':
        txHash = await sendStellarPayout(withdrawal);
        break;
      case 'HBAR':
        txHash = await sendHederaPayout(withdrawal);
        break;
    }

    // Update status to COMPLETED
    withdrawal.status = 'COMPLETED';
    withdrawal.txHash = txHash;
    await withdrawal.save();

    logger.info({ event: 'payout_success', chain: withdrawal.chain, txHash });

  } catch (err) {
    withdrawal.status = 'FAILED';
    withdrawal.error = err.message;
    await withdrawal.save();
    logger.error({ event: 'payout_failed', error: err.message });
  }
}

// ─────────────────── XRPL PAYOUT ───────────────────
async function sendXrplPayout(w) {
  const client = new Client(process.env.XRPL_RPC_URL);
  await client.connect();
  
  const wallet = Wallet.fromSeed(process.env.XRPL_HOT_WALLET_SEED);
  const prepared = await client.autofill({
    TransactionType: 'Payment',
    Account: wallet.address,
    Amount: xrpToDrops(w.amount.toString()),
    Destination: w.toAddress
  });

  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  await client.disconnect();
  return result.result.hash;
}

// ─────────────────── STELLAR PAYOUT ───────────────────
async function sendStellarPayout(w) {
  const server = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL);
  const sourceKeys = StellarSdk.Keypair.fromSecret(process.env.STELLAR_HOT_WALLET_SECRET);
  
  const account = await server.loadAccount(sourceKeys.publicKey());
  const transaction = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE })
    .addOperation(StellarSdk.Operation.payment({
      destination: w.toAddress,
      asset: StellarSdk.Asset.native(),
      amount: w.amount.toString()
    }))
    .setNetworkPassphrase(StellarSdk.Networks.PUBLIC)
    .setTimeout(30)
    .build();

  transaction.sign(sourceKeys);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

module.exports = { executeOnChainPayout };
