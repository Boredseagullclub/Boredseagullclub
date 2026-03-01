const { ethers } = require('ethers');
const rippleLib = require('ripple-lib');
const StellarSdk = require('stellar-sdk');
const { Client, TransferTransaction, Hbar } = require('@hashgraph/sdk');

async function settleOnChain(walletAddress, token, amount, chain) {
  switch (chain.toUpperCase()) {
    case 'FLR':
    case 'XDC':
      const provider = new ethers.JsonRpcProvider(process.env[`${chain}_RPC_URL`]);
      const wallet = new ethers.Wallet(process.env.BRIDGE_PRIVATE_KEY, provider);
      const tokenContract = new ethers.Contract(token.contractAddress, token.abi, wallet);
      const tx = await tokenContract.transfer(walletAddress, ethers.parseUnits(amount.toString(), token.decimals));
      await tx.wait();
      break;

    case 'XRPL':
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
      break;

    case 'XLM':
      const server = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL);
      const source = StellarSdk.Keypair.fromSecret(process.env.BRIDGE_STELLAR_SECRET);
      const account = await server.loadAccount(source.publicKey());
      const txStellar = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET
      }).addOperation(StellarSdk.Operation.payment({
        destination: walletAddress,
        asset: StellarSdk.Asset.native(),
        amount: amount.toString()
      })).setTimeout(30).build();
      txStellar.sign(source);
      await server.submitTransaction(txStellar);
      break;

    case 'HBAR':
      const hClient = Client.forTestnet();
      hClient.setOperator(process.env.BRIDGE_HBAR_ACCOUNT_ID, process.env.BRIDGE_HBAR_PRIVATE_KEY);
      const hTx = new TransferTransaction()
        .addHbarTransfer(process.env.BRIDGE_HBAR_ACCOUNT_ID, Hbar.fromTinybars(-amount))
        .addHbarTransfer(walletAddress, Hbar.fromTinybars(amount));
      await hTx.execute(hClient);
      break;

    default:
      throw new Error(`Unsupported chain for settlement: ${chain}`);
  }
}

module.exports = { settleOnChain };
