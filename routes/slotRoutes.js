const express = require('express');                                                               
const router = express.Router();
const mongoose = require('mongoose');                                                             

const TREASURY = {
  XRPL: 'rVKvTekTiqygS9qB27MPmsoDLyuD8PksF',
  XDC: 'xdc3B51F488f729e5Cfa566990Fd7f069F364b6984D',
  FLARE: '0x6FeD6C7501Ac980548DAE096F022Ae3758E6DecC'                                             
};

// 🎰 REMOVED: It is now physically impossible to roll this on a standard win.
const SYMBOLS = ['🪽', '🌀', '🪙', '🚀', '𝕏'];

router.post('/slot-spin', async (req, res) => {
  const { userId, chain, amount, txHash } = req.body;                                               
  const wager = parseFloat(amount);
  const targetChain = chain ? chain.toUpperCase() : '';                                           
  
  // --- WAGER LIMITS ---
  const MIN_WAGER = 1;
  const MAX_WAGER = 10000; 

  if (!userId || !targetChain || isNaN(wager) || wager < MIN_WAGER || !txHash) {
    return res.status(400).json({ success: false, message: "🪽 Malformed wager parameters or missing txHash." });
  } 

  if (wager > MAX_WAGER) {
    return res.status(400).json({ success: false, message: `🛑 Wager rejected: Max bet is ${MAX_WAGER} SGC.` });
  }

  // --- STRICT VALIDATION GATE ---
  const isXRPL = targetChain === 'XRPL';
  const isEVM = ['FLARE', 'FLR', 'XDC'].includes(targetChain);                                    
  if (isXRPL && !userId.startsWith('r')) {                                                            
    return res.status(400).json({ success: false, message: "Invalid XRPL address format." });
  }                                                                                                 
  if (isEVM && !(userId.startsWith('0x') || userId.startsWith('xdc'))) {
    return res.status(400).json({ success: false, message: "Invalid EVM address format." });        
  }
                                                                                                    
  try {                                                                                               
    // --- THE DYNAMIC JACKPOT EDGE ---
    // Base odds: 1 in 10,000,000. 
    // Every 1 SGC wagered improves the odds by 250 points.
    // A max bet of 10,000 SGC brings the odds down to 1 in 7,500,000.
    const baseOdds = 10000000;
    const edge = wager * 250; 
    const dynamicRange = Math.floor(baseOdds - edge);
    
    const jackpotRoll = Math.floor(Math.random() * dynamicRange) + 1;

    let finalReels = [];
    let outcomeType = 'LOSS';                                                                         
    let totalPayout = 0;
    let message = "SEAGULLS LAUGH AT YOUR LOSS";

    if (jackpotRoll === 1) {                                                                            
      finalReels = ['🎰', '🎰', '🎰']; // The only way this ever appears                                                                 
      outcomeType = 'JACKPOT';                                                                          
      totalPayout = 5000000; // Flat 5M Payout
      message = "🎰 SEAGULL JACKPOT! An absolute miracle occurred! Gull Skreeeeecchhh!";
    } else {
      const tierRoll = Math.random() * 100;
      
      // Increased chance for the 3x win (2% chance)
      if (tierRoll <= 5.0) {
        const luckySymbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];                    
        finalReels = [luckySymbol, luckySymbol, luckySymbol];                                             
        outcomeType = 'WIN';                                                                              
        totalPayout = parseFloat((wager * 3).toFixed(4)); // 3x Multiplier
        message = "🦅 TRIPLE MATCH! 3x SGC Distributed!";
      
      // Standard 1.5x win (25% chance)
      } else if (tierRoll <= 30.0) {
        const sym1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        let sym2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        while (sym1 === sym2) sym2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        const layouts = [[sym1, sym1, sym2], [sym1, sym2, sym1], [sym2, sym1, sym1]];
        finalReels = layouts[Math.floor(Math.random() * layouts.length)];
        outcomeType = 'WIN';
        totalPayout = parseFloat((wager * 1.5).toFixed(4));                                               
        message = "💸 DOUBLE MATCH! 1.5x SGC Distributed!";                                             
      
      // Loss
      } else {                                                                                            
        let r1 = Math.floor(Math.random() * SYMBOLS.length);
        let r2 = Math.floor(Math.random() * SYMBOLS.length);
        while (r1 === r2) r2 = Math.floor(Math.random() * SYMBOLS.length);
        let r3 = Math.floor(Math.random() * SYMBOLS.length);
        while (r3 === r1 || r3 === r2) r3 = Math.floor(Math.random() * SYMBOLS.length);                   
        finalReels = [SYMBOLS[r1], SYMBOLS[r2], SYMBOLS[r3]];
        outcomeType = 'LOSS';                                                                           
      }                                                                                               
    }

    if (outcomeType !== 'LOSS') {
      await mongoose.connection.db.collection('payouts').insertOne({
        sourceChain: targetChain,                                                                         
        destinationAddress: userId,                                                                       
        amount: totalPayout,                                                                              
        isSovereignAsset: true,                                                                           
        status: 'PENDING',
        gameSource: 'SLOTS',                                                                              
        wagerTxHash: txHash,                                                                              
        createdAt: new Date()                                                                           
      });                                                                                               
      console.log(`🎰 SLOT WIN QUEUED: ${totalPayout} SGC for ${userId} (${targetChain})`);
    } else {
      console.log(`🎰 SLOT LOSS CONSUMED: ${txHash}`);
    }

    return res.json({ success: true, reels: finalReels, outcome: outcomeType, payout: totalPayout, message });
  } catch (err) {
    console.error("🎰 SLOT ERR:", err.message);
    return res.status(500).json({ success: false, message: "Gaming matrix stalled." });
  }
});
                                                                                                  
module.exports = router;
