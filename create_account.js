const { Client, AccountCreateTransaction, PrivateKey, Hbar } = require("@hashgraph/sdk");

async function createMainnetAccount() {
    try {
        // 1. Connect to Mainnet
        const client = Client.forMainnet();
        client.setOperator("YOUR_EXISTING_ID", "YOUR_EXISTING_KEY");

        console.log("Generating keys...");
        // 2. Generate a fresh key pair
        const newPrivateKey = PrivateKey.generateED25519();
        const newPublicKey = newPrivateKey.publicKey;

        console.log("Submitting transaction to Hedera Mainnet...");
        // 3. Create the account
        const transaction = new AccountCreateTransaction()
            .setKey(newPublicKey)
            .setInitialBalance(new Hbar(2)); // Initial 2 HBAR funding

        const txResponse = await transaction.execute(client);
        const receipt = await txResponse.getReceipt(client);

        console.log("\n--- NEW MAINNET ACCOUNT CREATED ---");
        console.log("Account ID:", receipt.accountId.toString());
        console.log("Private Key (HEX):", newPrivateKey.toStringRaw());
        console.log("-----------------------------------\n");
        process.exit(0);
    } catch (err) {
        console.error("ERROR:", err.message);
        process.exit(1);
    }
}

createMainnetAccount();
