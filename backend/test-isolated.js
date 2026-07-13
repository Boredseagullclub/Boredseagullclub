const axios = require('axios');

const TARGET_ADDRESS = "0x870fbf19C74B1Fbe281086C147b97De0bB01A984";

async function checkRawNodeBalance() {
    console.log(`📡 Bypassing Ethers.js - Sending raw JSON-RPC payload for: ${TARGET_ADDRESS}\n`);

    const payload = {
        jsonrpc: "2.0",
        method: "eth_getBalance",
        params: [TARGET_ADDRESS, "latest"],
        id: 1
    };

    try {
        // 1. Raw XDC Query
        const xdcResponse = await axios.post("https://erpc.xdcrpc.com/", payload);
        if (xdcResponse.data.error) {
            console.log(`🔴 XDC Node Error:`, xdcResponse.data.error);
        } else {
            const xdcHex = xdcResponse.data.result;
            // Convert Hex to Decimal, handle '0x' explicitly
            const xdcDecimal = xdcHex === '0x' ? 0 : (BigInt(xdcHex).toString() / 1e18);
            console.log(`🟢 XDC Raw Output:   Hex: ${xdcHex} | Decimal: ${xdcDecimal}`);
        }

        console.log(`--------------------------------------------------`);

        // 2. Raw Flare Query
        const flareResponse = await axios.post("https://rpc.ankr.com/flare", payload);
        if (flareResponse.data.error) {
            console.log(`🔴 Flare Node Error:`, flareResponse.data.error);
        } else {
            const flareHex = flareResponse.data.result;
            const flareDecimal = flareHex === '0x' ? 0 : (BigInt(flareHex).toString() / 1e18);
            console.log(`🟢 Flare Raw Output: Hex: ${flareHex} | Decimal: ${flareDecimal}`);
        }

    } catch (err) {
        console.error(`❌ HTTP Request Failed: ${err.message}`);
    }
}

checkRawNodeBalance();
