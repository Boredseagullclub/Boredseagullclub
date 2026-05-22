const xrpl = require('xrpl');

async function main() {
    // 🦅 Use an official random credential to generate a perfectly formatted, legal wallet key
    const wallet = xrpl.Wallet.generate();
    
    console.log("Signing from active mock wallet:", wallet.address);

    const client = new xrpl.Client("wss://xrplcluster.com");
    await client.connect();

    // Build standard structure with exact sequence fallback for standalone offline serialization
    const tx = {
        TransactionType: "Payment",
        Account: wallet.address,
        Amount: xrpl.xrpToDrops("10"),
        Destination: "rVKvTekTiqygS9qB27MPmsoDLyuD8PksF",
        DestinationTag: 12345,
        Fee: "12",
        Sequence: 1
    };

    // Sign locally using valid cryptographic curves
    const signed = wallet.sign(tx);
    await client.disconnect();

    console.log("\n🚀 COPY AND PASTE THIS EXACT CURL COMMAND:\n");
    console.log(`curl -X POST https://seagull-xlm.xyz/api/wallet/broadcast \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{\n       "chain": "XRPL",\n       "signedBlob": "${signed.tx_blob}",\n       "memo": "12345"\n     }'\n`);
}

main().catch(console.error);
