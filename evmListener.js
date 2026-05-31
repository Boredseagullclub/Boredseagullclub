const { ethers } = require('ethers');
const mongoose = require('mongoose');
const logger = require('./logger');
const config = require('./config');

const Deposit = require('./models/Deposit');
const User = require('./models/User');

// Hardened redundancy pools with active fallback endpoints (Ankr Excluded)
const SUPPORTED_CHAINS = {
  XDC: {
    name: 'XDC',
    endpoints: [
      process.env.XDC_RPC_URL,
      'https://erpc.xdcrpc.com/',              // High-Throughput Cluster Alternate
      'https://arpc.xinfin.network/',          // Premium Tatum Gate Anchor
      'https://50.rpc.thirdweb.com/',          // High-Availability Mirror
      'https://rpc.xdc.org',                   // Canonical Foundation Node
      'https://rpc.xinfin.network'             // Standard Public Fallback Node
    ].filter(Boolean),
    chainId: 50,
    nativeToken: 'XDC',
    decimals: 18,
  },
  FLR: {
    name: 'FLR',
    endpoints: [
      process.env.FLR_RPC_URL,
      'https://flare.public-rpc.com',          // High-Availability Mirror Route
      'https://flare-api.flare.network/ext/C/rpc'
    ].filter(Boolean),
    chainId: 14,
    nativeToken: 'FLR',
    decimals: 18,
  },
};

const TRANSFER_SIG = ethers.id ? ethers.id('Transfer(address,address,uint256)') : ethers.utils.id('Transfer(address,address,uint256)');

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

  let providerConnected = false;

  for (const url of chainConfig.endpoints) {
    if (providerConnected) break;

    try {
      const isWss = url.startsWith('wss://') || url.startsWith('ws://');
      const provider = isWss
        ? new ethers.WebSocketProvider(url)
        : new (ethers.JsonRpcProvider || ethers.providers.JsonRpcProvider)(url, undefined, {
            staticNetwork: ethers.Network.from(chainConfig.chainId)
          });

      // Simple baseline health probe to verify endpoint responsiveness
      await provider.getBlockNumber();

      providers[chainKey] = provider;
      providerConnected = true;

      // Process new block frames via sequential parsing
      provider.on('block', async (blockNumber) => {
        try {
          const targetBlock = chainKey === 'FLR' ? blockNumber - 3 : blockNumber;
          if (targetBlock < 0) return;

          const block = await provider.getBlock(targetBlock, true);
          if (!block || !block.transactions) return;

          logger.debug({ module: 'EvmListener', chain: chainKey, event: 'block_received', block: targetBlock, txCount: block.transactions.length });

          // METERED PACING PIPELINE (Prevents Node 429 Rate-Exhaustion BANS)
          // Walks transactions sequentially rather than blasting a parallel network wall
          for (const tx of block.transactions) {
            try {
              // 1. Evaluate Native Token Movement
              if (tx.to && tx.value > 0n) {
                await processNativeTransfer(tx, chainKey, chainConfig);
              }

              // 2. Extract and Evaluate Contract Receipts
              const receipt = await provider.getTransactionReceipt(tx.hash);
              if (receipt && receipt.status === 1 && receipt.logs) {
                for (const log of receipt.logs) {
                  if (log.topics && log.topics[0] === TRANSFER_SIG) {
                    await processTransferLog(log, chainKey, chainConfig, tx.hash);
                  }
                }
              }

              // Minor execution delay (15ms) to give the RPC load balancer breathing room
              await new Promise(resolve => setTimeout(resolve, 15));

            } catch (txErr) {
              // Catches isolated transaction failures without crashing the block parser thread
              logger.debug({ module: 'EvmListener', chain: chainKey, event: 'tx_parse_failed', txHash: tx.hash, error: txErr.message });
            }
          }

        } catch (err) {
          if (err.message.includes('unfinalized') || err.message.includes('-32000')) {
            logger.debug({ module: 'EvmListener', chain: chainKey, event: 'unfinalized_block_skipped', blockNumber });
          } else {
            logger.error({ module: 'EvmListener', chain: chainKey, error: err.message });
          }
        }
      });

      logger.info({ module: 'EvmListener', event: 'connected', chain: chainKey, activeUrl: url });

      if (provider.websocket) provider.websocket.on('close', () => {
        logger.warn({ module: 'EvmListener', chain: chainKey, event: 'disconnected' });
        isRunning[chainKey] = false;
        setTimeout(() => startEvmListener(chainKey, chainConfig), 5000);
      });

    } catch (err) {
      logger.warn({ module: 'EvmListener', chain: chainKey, event: 'rpc_bypass', url, error: err.message });
    }
  }

  if (!providerConnected) {
    logger.error({ module: 'EvmListener', chain: chainKey, error: 'All gateway endpoints exhausted or blocked.' });
    isRunning[chainKey] = false;
    setTimeout(() => startEvmListener(chainKey, chainConfig), 10000);
  }
}

// Native token processing (XDC/FLR)
async function processNativeTransfer(tx, chainKey, chainConfig) {
  // Sanitize address layout cleanly to standard 0x lower strings (prevents v6 ENS operational crashes)
  const toAddr = tx.to.toLowerCase().replace(/^xdc/, '0x');
  const user = await User.findOne({ [`evmDeposits.${chainKey}`]: toAddr }).lean();
  if (!user) return;

  const formatUnits = ethers.formatUnits || ethers.utils.formatUnits;
  const amount = formatUnits(tx.value, chainConfig.decimals);
  const cleanFromAddress = tx.from.toLowerCase().replace(/^xdc/, '0x');

  await Deposit.updateOne(
    { txHash: tx.hash, chain: chainKey },
    {
      $setOnInsert: {
        userId: user._id,
        walletAddress: cleanFromAddress,
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

// ERC-20 log processing (SeagullCoin and SeagullCash tracking)
async function processTransferLog(log, chainKey, chainConfig, parentTxHash) {
  if (!log.topics || log.topics.length !== 3) return;

  const to = '0x' + log.topics[2].slice(-40).toLowerCase();
  const user = await User.findOne({ [`evmDeposits.${chainKey}`]: to }).lean();
  if (!user) return;

  const logAddressClean = log.address.toLowerCase().replace(/^xdc/, '0x');
  const tokenInfo = Object.values(config.TOKENS || {}).find(t => t.networks?.[chainKey]?.contract === logAddressClean);
  if (!tokenInfo) return;

  const tokenSymbol = tokenInfo.symbol;
  const decimals = tokenInfo.networks[chainKey].decimals || 18;
  
  const formatUnits = ethers.formatUnits || ethers.utils.formatUnits;
  const amount = formatUnits(log.data, decimals);

  const txHash = log.transactionHash || parentTxHash;
  const cleanFromAddress = '0x' + log.topics[1].slice(-40).toLowerCase();

  await Deposit.updateOne(
    { txHash: txHash, chain: chainKey },
    {
      $setOnInsert: {
        userId: user._id,
        walletAddress: cleanFromAddress,
        chain: chainKey,
        token: tokenSymbol,
        txHash: txHash,
        amount: mongoose.Types.Decimal128.fromString(amount),
        txTimestamp: new Date(),
        status: 'DETECTED',
        confirmations: 1,
      }
    },
    { upsert: true }
  );

  logger.info({ module: 'EvmListener', chain: chainKey, event: 'token_deposit', token: tokenSymbol, txHash, amount });
}

module.exports = startEvmListeners;
