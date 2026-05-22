const { ethers } = require('ethers');
const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const logger = require('./logger');
const config = require('./config'); // your token config

const Deposit = require('./models/Deposit');
const User = require('./models/User');

const SUPPORTED_CHAINS = {
  XDC: {
    name: 'XDC',
    rpcUrl: process.env.XDC_RPC_URL || 'https://rpc.xdc.network',
    chainId: 50,
    nativeToken: 'XDC',
    decimals: 18,
  },
  FLR: {
    name: 'FLR',
    rpcUrl: process.env.FLR_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    chainId: 14,
    nativeToken: 'FLR',
    decimals: 18,
  },
};

const TRANSFER_SIG = ethers.utils?.id || ethers.id('Transfer(address,address,uint256)');

let providers = {};
let isRunning = {};

async function startEvmListeners() {
  for (const [chainKey, chainConfig] of Object.entries(SUPPORTED_CHAINS)) {
    logger.info({ module: 'EvmListener', event: 'start', chain: chainKey });
    await startEvmListener(chainKey, chainConfig);
  }
}

async function startEvmListener(chainKey, chainConfig) {
  if (isRunning[chainKey]) return;
  isRunning[chainKey] = true;

  try {
    const isWss = chainConfig.rpcUrl.startsWith('wss://') || chainConfig.rpcUrl.startsWith('ws://');
    const provider = isWss ? new ethers.WebSocketProvider(chainConfig.rpcUrl) : new (ethers.JsonRpcProvider || ethers.providers.JsonRpcProvider)(chainConfig.rpcUrl);
    providers[chainKey] = provider;

    // Listen for new blocks and process both native + token transfers safely inline (bypassing eth_newFilter)
    provider.on('block', async (blockNumber) => {
      try {
        // Force a 3-block finality depth for Flare to prevent "cannot query unfinalized data" RPC crashes
        const targetBlock = chainKey === 'FLR' ? blockNumber - 3 : blockNumber;
        if (targetBlock < 0) return;

        const block = await provider.getBlock(targetBlock, true);
        if (!block || !block.transactions) return;

        for (const tx of block.transactions) {
          // 1. Native token transfer check (XDC/FLR)
          if (tx.to && tx.value > 0n) {
            await processNativeTransfer(tx, chainKey, chainConfig);
          }

          // 2. ERC-20 Token transfer check via receipt extraction
          try {
            const receipt = await provider.getTransactionReceipt(tx.hash);
            if (receipt && receipt.status === 1 && receipt.logs) {
              for (const log of receipt.logs) {
                if (log.topics && log.topics[0] === TRANSFER_SIG) {
                  await processTransferLog(log, chainKey, chainConfig);
                }
              }
            }
          } catch (receiptErr) {
            logger.debug({ module: 'EvmListener', chain: chainKey, event: 'receipt_fetch_failed', txHash: tx.hash, error: receiptErr.message });
          }
        }
      } catch (err) {
        // Gracefully catch any transient unfinalized data exceptions without breaking the stream loop
        if (err.message.includes('unfinalized') || err.message.includes('-32000')) {
          logger.debug({ module: 'EvmListener', chain: chainKey, event: 'unfinalized_block_skipped', blockNumber });
        } else {
          logger.error({ module: 'EvmListener', chain: chainKey, error: err.message });
        }
      }
    });

    logger.info({ module: 'EvmListener', event: 'connected', chain: chainKey });

    // Reconnect on disconnect
    if (provider.websocket) provider.websocket.on('close', () => {
      logger.warn({ module: 'EvmListener', chain: chainKey, event: 'disconnected' });
      isRunning[chainKey] = false;
      setTimeout(() => startEvmListener(chainKey, chainConfig), 5000);
    });

  } catch (err) {
    logger.error({ module: 'EvmListener', chain: chainKey, error: err.message });
    isRunning[chainKey] = false;
  }
}

// Native token transfer (XDC/FLR)
async function processNativeTransfer(tx, chainKey, chainConfig) {
  const toAddr = tx.to.toLowerCase();
  const user = await User.findOne({ [`evmDeposits.${chainKey}`]: toAddr });
  if (!user) return;

  const amount = ethers.formatUnits(tx.value, chainConfig.decimals);

  await Deposit.updateOne(
    { txHash: tx.hash, chain: chainKey },
    {
      $setOnInsert: {
        userId: user._id,
        walletAddress: tx.from.toLowerCase(),
        chain: chainKey,
        token: chainConfig.nativeToken,
        txHash: tx.hash,
        amount: mongoose.Types.Decimal128.fromString(amount),
        txTimestamp: new Date(),
        status: 'DETECTED',
        confirmations: 1,
      }
    },
    { upsert: true }
  );

  logger.info({ module: 'EvmListener', chain: chainKey, event: 'native_deposit', txHash: tx.hash, amount });
}

// ERC-20 Transfer log
async function processTransferLog(log, chainKey, chainConfig) {
  if (log.topics.length !== 3) return; // Transfer event has 3 topics

  const to = '0x' + log.topics[2].slice(-40).toLowerCase();
  const user = await User.findOne({ [`evmDeposits.${chainKey}`]: to });
  if (!user) return;

  // Lookup token from config (filter only known tokens)
  const tokenInfo = Object.values(config.TOKENS).find(t => t.networks?.[chainKey]?.contract === log.address.toLowerCase());
  if (!tokenInfo) return; // ignore unknown tokens

  const tokenSymbol = tokenInfo.symbol;
  const decimals = tokenInfo.networks[chainKey].decimals || 18;
  const amount = ethers.formatUnits(log.data, decimals);

  await Deposit.updateOne(
    { txHash: log.transactionHash, chain: chainKey },
    {
      $setOnInsert: {
        userId: user._id,
        walletAddress: '0x' + log.topics[1].slice(-40).toLowerCase(), // from
        chain: chainKey,
        token: tokenSymbol,
        txHash: log.transactionHash,
        amount: mongoose.Types.Decimal128.fromString(amount),
        txTimestamp: new Date(),
        status: 'DETECTED',
        confirmations: 1,
      }
    },
    { upsert: true }
  );

  logger.info({ module: 'EvmListener', chain: chainKey, event: 'token_deposit', token: tokenSymbol, amount });
}

module.exports = startEvmListeners;
