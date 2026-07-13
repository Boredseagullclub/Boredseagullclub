require('dotenv').config();
const { ethers } = require('ethers');

// The REAL Ecosystem Registry pulled straight from HolderIndexer.js
const REGS = {
    XDC_SGC: '0xd38109f587bd0326cad60a18cf3c1ecd546809a6', // SeagullCoin on XDC
    FLR_SGC: '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f'  // SeagullCoin on Flare
};

const TARGET_ADDRESS = "0x870fbf19C74B1Fbe281086C147b97De0bB01A984";
const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];

async function runDirectQuery() {
    console.log(`\n📡 Querying Core Ledgers Directly For: ${TARGET_ADDRESS}\n`);

    // 1. Direct Execution for XDC Network (Using the high-speed cluster instead of the dead url)
    try {
        const xdcProvider = new ethers.JsonRpcProvider('https://erpc.xdcrpc.com/');
        const rawBal = await xdcProvider.getBalance(TARGET_ADDRESS);
        
        const contract = new ethers.Contract(REGS.XDC_SGC, ERC20_ABI, xdcProvider);
        const tokenBal = await contract.balanceOf(TARGET_ADDRESS);

        console.log(`🟢 [XDC LIVE NODE RESPONSE]`);
        console.log(`   Native XDC Balance:   ${ethers.formatEther(rawBal)}`);
        console.log(`   SeagullCoin Balance:  ${ethers.formatEther(tokenBal)}`);
    } catch (err) {
        console.log(`🔴 [XDC Node Error]: ${err.message}`);
    }

    console.log(`\n--------------------------------------------------\n`);

    // 2. Direct Execution for Flare Network
    try {
        const flrProvider = new ethers.JsonRpcProvider('https://rpc.ankr.com/flare');
        const rawBal = await flrProvider.getBalance(TARGET_ADDRESS);
        
        const contract = new ethers.Contract(REGS.FLR_SGC, ERC20_ABI, flrProvider);
        const tokenBal = await contract.balanceOf(TARGET_ADDRESS);

        console.log(`🟢 [FLARE LIVE NODE RESPONSE]`);
        console.log(`   Native FLR Balance:   ${ethers.formatEther(rawBal)}`);
        console.log(`   SeagullCoin Balance:  ${ethers.formatEther(tokenBal)}`);
    } catch (err) {
        console.log(`🔴 [Flare Node Error]: ${err.message}`);
    }
    console.log("");
}

runDirectQuery();
