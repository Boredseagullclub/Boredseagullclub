const bridge = require('./services/bridgeService');

async function testStellar() {
    console.log("🦅 IGNITING STELLAR ISO SETTLEMENT FOR SEAGULLCASH...");

    // CONFIGURATION
    const walletAddress = 'GBTOS6U2OO2ROHSR2KRGRC7W73EAYWD6UW4BWBWOOXMJ3EZN7IA5JE5R'; 
    const tokenSymbol = 'SeagullCash'; 
    const amount = 1.0;
    const chain = 'XLM'; 

    try {
        const result = await bridge.settleOnChain(
            walletAddress, 
            tokenSymbol, 
            amount, 
            chain
        );
        
        console.log("--------------------------------------------------");
        console.log(`✅ SUCCESS! SeagullCash ISO Hash Anchored.`);
        console.log(`🔗 Transaction Hash: ${result}`);
        console.log("--------------------------------------------------");

    } catch (error) {
        console.error("--------------------------------------------------");
        console.error("❌ STELLAR BRIDGE FAILED");
        
        // 👇 THIS IS THE NEW PART: It looks for the "Result Code" (e.g., op_no_trust)
        const detailedError = error.response?.data?.extras?.result_codes?.operations?.[0] 
                            || error.response?.data?.detail 
                            || error.message;

        console.error("Reason:", detailedError);
        console.error("--------------------------------------------------");
    }
}

testStellar();

