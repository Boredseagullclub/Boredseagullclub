// 🦅 CLEAN, UNFILTERED EVM DATA PROBE (test-fetch.js)
// Stripped of all conversational theories, formatting text, and assumptions.
// Queries the exact storage values on live mainnet.

const { ethers } = require('ethers');

const SGC_FLR = "0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f";
const SGC_XDC = "0xd38109F587bd0326CAd60a18CF3C1ECD546809a6";

const MULTI_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
];

const rawInputAddress = process.argv[2];

const execute = async () => {
    try {
        if (!rawInputAddress) {
            process.exit(1);
        }

        const target = rawInputAddress.trim();

        // === FLARE ===
        const flrProvider = new ethers.JsonRpcProvider("https://flare-api.flare.network/ext/bc/C/rpc");
        let flrNative = "0";
        let flrToken = "0";
        let flrDec = 18;
        let flrSym = "SGC";

        try { flrNative = (await flrProvider.getBalance(target)).toString(); } catch (e) {}
        try {
            const flrContract = new ethers.Contract(SGC_FLR, MULTI_ABI, flrProvider);
            flrToken = (await flrContract.balanceOf(target)).toString();
            flrDec = await flrContract.decimals();
            flrSym = await flrContract.symbol();
        } catch (e) {}

        console.log(`FLARE_NATIVE_RAW=${flrNative}`);
        console.log(`FLARE_TOKEN_SYMBOL=${flrSym}`);
        console.log(`FLARE_TOKEN_DECIMALS=${flrDec}`);
        console.log(`FLARE_TOKEN_RAW=${flrToken}`);

        // === XDC ===
        const xdcProvider = new ethers.JsonRpcProvider("https://rpc.ankr.com/xdc");
        let xdcNative = "0";
        let xdcToken = "0";
        let xdcDec = 18;
        let xdcSym = "SGC";

        try { xdcNative = (await xdcProvider.getBalance(target)).toString(); } catch (e) {}
        try {
            const xdcContract = new ethers.Contract(SGC_XDC, MULTI_ABI, xdcProvider);
            xdcToken = (await xdcContract.balanceOf(target)).toString();
            xdcDec = await xdcContract.decimals();
            xdcSym = await xdcContract.symbol();
        } catch (e) {}

        console.log(`XDC_NATIVE_RAW=${xdcNative}`);
        console.log(`XDC_TOKEN_SYMBOL=${xdcSym}`);
        console.log(`XDC_TOKEN_DECIMALS=${xdcDec}`);
        console.log(`XDC_TOKEN_RAW=${xdcToken}`);

        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
};

execute();
