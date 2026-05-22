const { Client, TokenAssociateTransaction, AccountId, PrivateKey } = require("@hashgraph/sdk");
require('dotenv').config();

async function associate() {
    const client = Client.forMainnet();
    // ⚠️ USE THE RECIPIENT'S KEYS HERE, NOT THE BRIDGE'S
    const recipientId = AccountId.fromString("RECIPIENT_ACCOUNT_ID"); 
    const recipientKey = PrivateKey.fromStringECDSA("RECIPIENT_PRIVATE_KEY");
    
    client.setOperator(recipientId, recipientKey);

    const transaction = await new TokenAssociateTransaction()
        .setAccountId(recipientId)
        .setTokenIds([process.env.HEDERA_TOKEN_ID])
        .freezeWith(client);

    const signTx = await transaction.sign(recipientKey);
    const response = await signTx.execute(client);
    const receipt = await response.getReceipt(client);

    console.log(`✅ Association Status: ${receipt.status.toString()}`);
}
associate();

