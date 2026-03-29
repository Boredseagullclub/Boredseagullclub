// BridgeService.js
const { ethers } = require('ethers');
const { Client: XrplClient, xrpToDrops } = require('xrpl');
const StellarSdk = require('stellar-sdk');
const { Client, TransferTransaction, Hbar } = require('@hashgraph/sdk');
const Decimal = require('decimal.js');
const config = require('./config'); // Flat-file lookup for FEES
const logger = require('./logger');

/**
 * SETTLE ON CHAIN
 * This is the ONLY place where money leaves the engine. 
 * Fees are deducted here for Outbound transfers.
 */
async function settleOnChain(walletAddress, tokenSymbol, amount, chain) {
  const symbol = tokenSymbol.toUpperCase();
  const chainUpper = chain.toUpperCase();
  
  // 1. DETERMINE FEE (0.4% Native vs 0.1% Seagull)
  let feeRate = config.FEES[symbol];
  if (!feeRate) {
    // Check if it's a native asset defined in CHAINS (XRP, XLM, etc)
    const isNative = Object.values(config.CHAINS).some(c => c.nativeSymbol === symbol);
    feeRate = isNative ? config.FEES.NATIVE_ASSET : config.FEES.DEFAULT;
  }

  // 2. CALCULATE DEDUCTION
  const rawAmount = new Decimal(amount.toString());
  const feeToTake = rawAmount.times(feeRate);
  const amountToActuallySend = rawAmount.minus(feeToTake);

  logger.info({
    module: 'BridgeService',
    event: 'outbound_fee_applied',
    token: symbol,
    original: amount.toString(),
    fee: feeToTake.toString(),
    finalPayout: amountToActuallySend.toString()
  });

  // 3. EXECUTE ON-CHAIN PAYOUT
  switch (chainUpper) {
    case 'FLR':
    case 'XDC': {
      const provider = new ethers.JsonRpcProvider(process.env[`${chainUpper}_RPC_URL`]);
      const wallet = new ethers.Wallet(process.env.BRIDGE_PRIVATE_KEY, provider);
      // Logic assumes token contract info is in config.TOKENS[symbol]
      const tokenSpec = config.TOKENS[symbol]?.networks?.[chainUpper];
      if (!tokenSpec) throw new Error(`Token spec missing for ${symbol} on ${chainUpper}`);

      const contract = new ethers.Contract(tokenSpec.contract, ['function transfer(address,uint256)'], wallet);
      const tx = await contract.transfer(walletAddress, ethers.parseUnits(amountToActuallySend.toFixed(tokenSpec.decimals), tokenSpec.decimals));
      await tx.wait();
      return tx.hash;
    }

    case 'XRPL': {
      const xClient = new XrplClient(process.env.XRPL_RPC_URL);
      await xClient.connect();
      const xWallet = XrplClient.fromSeed(process.env.BRIDGE_XRPL_SECRET);
      
      const prepared = await xClient.autofill({
        TransactionType: 'Payment',
        Account: process.env.BRIDGE_XRPL_ADDRESS,
        Amount: symbol === 'XRP' 
                ? xrpToDrops(amountToActuallySend.toString()) 
                : { 
                    currency: symbol, 
                    issuer: config.TOKENS[symbol].networks.XRP.issuer, 
                    value: amountToActuallySend.toString() 
                  },
        Destination: walletAddress
      });
      const signed = xWallet.sign(prepared);
      const result = await xClient.submitAndWait(signed.tx_blob);
      await xClient.disconnect();
      return result.result.hash;
    }

    case 'XLM': {
      const server = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL);
      const source = StellarSdk.Keypair.fromSecret(process.env.BRIDGE_STELLAR_SECRET);
      const account = await server.loadAccount(source.publicKey());
      
      const asset = symbol === 'XLM' 
                    ? StellarSdk.Asset.native() 
                    : new StellarSdk.Asset(symbol, config.TOKENS[symbol].networks.XLM.issuer);

      const txStellar = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: process.env.STELLAR_NETWORK === 'PUBLIC' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET
      }).addOperation(StellarSdk.Operation.payment({
        destination: walletAddress,
        asset: asset,
        amount: amountToActuallySend.toFixed(7) // Stellar max 7 decimals
      })).setTimeout(30).build();
      
      txStellar.sign(source);
      const res = await server.submitTransaction(txStellar);
      return res.hash;
    }

    case 'HBAR': {
      const hClient = process.env.HEDERA_NETWORK === 'testnet' ? Client.forTestnet() : Client.forMainnet();
      hClient.setOperator(process.env.BRIDGE_HBAR_ACCOUNT_ID, process.env.BRIDGE_HBAR_PRIVATE_KEY);
      
      const hTx = new TransferTransaction()
        .addHbarTransfer(process.env.BRIDGE_HBAR_ACCOUNT_ID, Hbar.fromTinybars(-amountToActuallySend.times(1e8).toNumber()))
        .addHbarTransfer(walletAddress, Hbar.fromTinybars(amountToActuallySend.times(1e8).toNumber()));
      
      const response = await hTx.execute(hClient);
      return response.transactionId.toString();
    }

    default:
      throw new Error(`Chain ${chain} not supported in BridgeService`);
  }
}

module.exports = { settleOnChain };
