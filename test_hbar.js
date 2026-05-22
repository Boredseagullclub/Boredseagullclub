const bridge = require('./services/bridgeService');
const crypto = require('crypto');

async function runTest() {
    console.log("🦅 IGNITING HEDERA ISO SETTLEMENT FOR SEAGULLCASH...");

    // 1. Generate the ISO 20022 Hash
    const isoData = JSON.stringify({
        msgId: `SEGL-${Date.now()}`,
        creDtTm: new Date().toISOString(),
        instdAmt: { amt: 1.0, ccy: "SeagullCash" },
        dbtr: "SeagullVault_Alpha",
        cdtr: "User_Wallet_Beta"
    });

    const isoHash = crypto.createHash('sha256').update(isoData).digest('hex');

    // 🦅 MAINNET ACCOUNT ID
    const testRecipient = "0.0.3116872";
    const testAmount = 1.0;

    try {
        console.log(`🔗 Anchoring ISO Hash: ${isoHash.substring(0, 16)}...`);

        // 🦅 THE CORRECT ORDER: (Address, String, Number, Chain, Hash)
        const result = await bridge.settleOnChain(
            testRecipient,   // 1. walletAddress
            'SeagullCash',   // 2. tokenSymbol (The String! This stops the toUpperCase error)
            testAmount,      // 3. amount (The Number!)
            'HBAR',          // 4. chain
            isoHash          // 5. isoHash
        );

        console.log("--------------------------------------------------");
        console.log("✅ SUCCESS! Hedera ISO Hash Anchored.");
        console.log("Transaction ID:", result);
        console.log("--------------------------------------------------");
    } catch (error) {
        console.log("--------------------------------------------------");
        console.log("❌ HEDERA BRIDGE FAILED");
        console.log("Reason:", error.message);
        console.log("--------------------------------------------------");
    }
}

runTest();

