const { ethers } = require('ethers');
const mongoose = require('mongoose');
const logger = require('./logger');
const config = require('./config');

const Deposit = require('./models/Deposit');
const User = require('./models/User');

// Hardened redundancy pools with premium institutional endpoints
const SUPPORTED_CHAINS = {
  XDC: {
    name: 'XDC',
    endpoints: [
      process.env.XDC_RPC_URL,
      'https://arpc.xinfin.network/',          // Premium Tatum Gate Anchor
      'https://erpc.xdcrpc.com/',              // High-Throughput Cluster
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
      'https://flare-api.flare.network/ext/C/rpc',
      'https://flare.public-rpc.com',
      'https://rpc.ankr.com/flare'
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

      // Process new block frames via highly-parallel parsing
      provider.on('block', async (blockNumber) => {
        try {
          const targetBlock = chainKey === 'FLR' ? blockNumber - 3 : blockNumber;
          if (targetBlock < 0) return;

          const block = await provider.getBlock(targetBlock, true);
          if (!block || !block.transactions) return;

          logger.debug({ module: 'EvmListener', chain: chainKey, event: 'block_received', block: targetBlock, txCount: block.transactions.length });

          // HIGH-SPEED BATCHING WORKER POOL
          // Process blocks with intense transaction volumes asynchronously inside chunks
          const BATCH_SIZE = 15;
          const transactions = block.transactions;
          
          for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
            const batch = transactions.slice(i, i + BATCH_SIZE);
            
            await Promise.all(batch.map(async (tx) => {
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
              } catch (txErr) {
                // Catches isolated transaction failures without crashing the block parser thread
                logger.debug({ module: 'EvmListener', chain: chainKey, event: 'tx_parse_failed', txHash: tx.hash, error: txErr.message });
              }
            }));
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
  const toAddr = tx.to.toLowerCase();
  const user = await User.findOne({ [`evmDeposits.${chainKey}`]: toAddr }).lean();
  if (!user) return;

  const formatUnits = ethers.formatUnits || ethers.utils.formatUnits;
  const amount = formatUnits(tx.value, chainConfig.decimals);

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

// ERC-20 log processing (SeagullCoin and SeagullCash tracking)
async function processTransferLog(log, chainKey, chainConfig, parentTxHash) {
  if (!log.topics || log.topics.length !== 3) return;

  const to = '0x' + log.topics[2].slice(-40).toLowerCase();
  const user = await User.findOne({ [`evmDeposits.${chainKey}`]: to }).lean();
  if (!user) return;

  const tokenInfo = Object.values(config.TOKENS || {}).find(t => t.networks?.[chainKey]?.contract === log.address.toLowerCase());
  if (!tokenInfo) return;

  const tokenSymbol = tokenInfo.symbol;
  const decimals = tokenInfo.networks[chainKey].decimals || 18;
  
  const formatUnits = ethers.formatUnits || ethers.utils.formatUnits;
  const amount = formatUnits(log.data, decimals);

  const txHash = log.transactionHash || parentTxHash;

  await Deposit.updateOne(
    { txHash: txHash, chain: chainKey },
    {
      $setOnInsert: {
        userId: user._id,
        walletAddress: '0x' + log.topics[1].slice(-40).toLowerCase(),
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
