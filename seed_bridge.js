const StellarSdk = require('stellar-sdk');
require('dotenv').config();

async function seedBridge() {
    // 1. Setup the Server
    const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
    
    // 2. The Keys
    // You'll need to add ISSUER_SECRET to your .env for this one-time move
    const issuerKeypair = StellarSdk.Keypair.fromSecret(process.env.ISSUER_SECRET);
    const bridgeWalletAddress = 'GD2VMYH62JD2ZGTMMWFCU5YNMASC5NWZ5FM5WN2GWLYAACYXP6BKG44I';

    try {
        const account = await server.loadAccount(issuerKeypair.publicKey());
        const asset = new StellarSdk.Asset(
            'SeagullCash', 
            'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7'
        );

        console.log("🦅 SEEDING BRIDGE WITH SEAGULLCASH...");

        const transaction = new StellarSdk.TransactionBuilder(account, {
            fee: StellarSdk.BASE_FEE
        })
        .addOperation(StellarSdk.Operation.payment({
            destination: bridgeWalletAddress,
            asset: asset,
            amount: '1000.0000000' // Sending 1,000 tokens to the bridge
        }))
        .setNetworkPassphrase(StellarSdk.Networks.PUBLIC)
        .setTimeout(30)
        .build();

        transaction.sign(issuerKeypair);
        const result = await server.submitTransaction(transaction);
        
        console.log('✅ SEED SUCCESS! Hash:', result.hash);
    } catch (e) {
        console.error('❌ SEED FAILED:', e.response?.data?.extras?.result_codes || e.message);
    }
}

seedBridge();
