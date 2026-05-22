const StellarSdk = require('stellar-sdk');
require('dotenv').config();

async function createTrust() {
  const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
  const issuerAddress = 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7';
  
  // This is the account receiving the SeagullCash
  const receiverSecret = process.env.BRIDGE_STELLAR_SECRET; 
  const receiverKeyPair = StellarSdk.Keypair.fromSecret(receiverSecret);
  
  try {
    const account = await server.loadAccount(receiverKeyPair.publicKey());
    const asset = new StellarSdk.Asset('SEAGULLCASH', issuerAddress);

    console.log("🦅 ESTABLISHING SOVEREIGN TRUSTLINE FOR SEAGULLCASH...");

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.PUBLIC
    })
    .addOperation(StellarSdk.Operation.changeTrust({
      asset: asset
    }))
    .setTimeout(30)
    .build();

    transaction.sign(receiverKeyPair);
    const result = await server.submitTransaction(transaction);
    console.log("✅ TRUSTLINE ESTABLISHED! Hash: " + result.hash);
  } catch (err) {
    console.error("❌ TRUSTLINE FAILED: ", err.response ? err.response.data.extras.result_codes : err.message);
  }
}
createTrust();
