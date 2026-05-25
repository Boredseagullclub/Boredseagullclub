const mongoose = require('mongoose');
require('dotenv').config(); 
const { triggerGlobalEcosystemSync } = require('./services/HolderIndexer');

async function runManualVerify() {
    console.log("Connecting to your MongoDB replica set...");
    await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/Boredseagullclub");
    
    // Explicitly wait 2 seconds to guarantee rs0 is fully initialized
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`Current Database Connection State Status: ${mongoose.connection.readyState} (1 = CONNECTED)`);

    console.log("Starting full multi-chain snapshot retrieval...");
    await triggerGlobalEcosystemSync();
    
    console.log("Execution complete. Disconnecting...");
    await mongoose.connection.close();
    process.exit(0);
}

runManualVerify().catch(err => {
    console.error("CRITICAL FAILURE:", err.message);
    process.exit(1);
});
