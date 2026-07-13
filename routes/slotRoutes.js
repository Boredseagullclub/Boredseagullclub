const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const TREASURY = {
  XRPL: 'rVKvTekTiqygS9qB27MPmsoDLyuD8PksF',
  XDC: 'xdc3B51F488f729e5Cfa566990Fd7f069F364b6984D',
  FLARE: '0x6FeD6C7501Ac980548DAE096F022Ae3758E6DecC'
};

const SYMBOLS = ['🪽', '🌀', '🪙', '🎰', '🚀', '𝕏'];

router.post('/slot-spin', async (req, res) => {
  const { userId, chain, amount, txHash } = req.body;
  const wager = parseFloat(amount);
  const targetChain = chain ? chain.toUpperCase() : '';

  if (!userId || !targetChain || isNaN(wager) || wager <= 0 || !txHash) {
    return res.status(400).json({ success: false, message: "🪽 Malformed wager parameters or missing txHash." });
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
    const JACKPOT_RANGE = 5000000;
    const jackpotRoll = Math.floor(Math.random() * JACKPOT_RANGE) + 1;

    let finalReels = [];
    let outcomeType = 'LOSS';
    let totalPayout = 0;
    let message = "House wins. Stake securely locked into Treasury pool.";

    if (jackpotRoll === 1) {
      finalReels = ['🎰', '🎰', '🎰'];
      outcomeType = 'JACKPOT';
      totalPayout = 5000000;
      message = "🎰 GRAND JACKPOT! An absolute miracle occurred! 5,000,000 SGC Distributed!";
    } else {
      const tierRoll = Math.random() * 100;
      if (tierRoll <= 0.2) {
        const luckySymbol = SYMBOLS[Math.floor(Math.random() * (SYMBOLS.length - 1))];
        finalReels = [luckySymbol, luckySymbol, luckySymbol];
        outcomeType = 'WIN';
        totalPayout = parseFloat((wager * 5).toFixed(4));
        message = "🦅 TRIPLE MATCH! 5x SGC Distributed!";
      } else if (tierRoll <= 27.8) {
        const sym1 = SYMBOLS[Math.floor(Math.random() * (SYMBOLS.length - 1))];
        let sym2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        while (sym1 === sym2) sym2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        const layouts = [[sym1, sym1, sym2], [sym1, sym2, sym1], [sym2, sym1, sym1]];
        finalReels = layouts[Math.floor(Math.random() * layouts.length)];
        outcomeType = 'WIN';
        totalPayout = parseFloat((wager * 1.5).toFixed(4));
        message = "💸 DOUBLE MATCH! 1.5x SGC Distributed!";
      } else {
        let r1 = Math.floor(Math.random() * SYMBOLS.length);
        let r2 = Math.floor(Math.random() * SYMBOLS.length);
        while (r1 === r2) r2 = Math.floor(Math.random() * SYMBOLS.length);
        let r3 = Math.floor(Math.random() * SYMBOLS.length);
        while (r3 === r1 || r3 === r2) r3 = Math.floor(Math.random() * SYMBOLS.length);
        finalReels = [SYMBOLS[r1], SYMBOLS[r2], SYMBOLS[r3]];
        if (finalReels.every(s => s === '🎰')) finalReels[2] = SYMBOLS[(r3 + 1) % SYMBOLS.length];
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
