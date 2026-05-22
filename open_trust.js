require('dotenv').config();
const StellarSdk = require('stellar-sdk');

async function openTrust() {
    // 1. Connect to Public Network
    const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");

    // 2. Load the Secret from .env (KEEPING IT SECURE)
    // This looks for BRIDGE_STELLAR_SECRET in your .env file
    const rawSecret = process.env.BRIDGE_STELLAR_SECRET || '';
    const receiverSecret = rawSecret.trim().replace(/['";\s]/g, '');

    // Debugging to ensure the .env is being read correctly
    console.log(`🔍 DEBUG: Length is ${receiverSecret.length}`);
    console.log(`🔍 DEBUG: Starts with ${receiverSecret[0]}`);

    if (receiverSecret.length !== 56 || !receiverSecret.startsWith('S')) {
        console.error("❌ ERROR: Invalid Stellar Secret Key. Must be 56 characters and start with 'S'.");
        console.log("Check your .env file for BRIDGE_STELLAR_SECRET");
        return;
    }

    try {
        const receiverKeypair = StellarSdk.Keypair.fromSecret(receiverSecret);
        const asset = new StellarSdk.Asset(
            'SeagullCash',
            'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7'
        );

        console.log("🦅 LOADING ACCOUNT...");
        const account = await server.loadAccount(receiverKeypair.publicKey());
        
        console.log("🦅 BUILDING TRUSTLINE TRANSACTION...");
        const tx = new StellarSdk.TransactionBuilder(account, { 
            fee: StellarSdk.BASE_FEE 
        })
            .addOperation(StellarSdk.Operation.changeTrust({ 
                asset: asset 
            }))
            .setNetworkPassphrase(StellarSdk.Networks.PUBLIC)
            .setTimeout(30)
            .build();

        tx.sign(receiverKeypair);
        
        console.log("🦅 SUBMITTING TO STELLAR...");
        const res = await server.submitTransaction(tx);
        console.log("✅ TRUSTLINE OPEN! Hash:", res.hash);

    } catch (e) {
        // Detailed error reporting for Stellar result codes
        const resultCodes = e.response?.data?.extras?.result_codes;
        console.error("❌ FAILED:", resultCodes || e.message);
    }
}

openTrust();

