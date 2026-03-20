const mongoose = require('mongoose');

const WalletStatsSchema = new mongoose.Schema({
  chain: { 
    type: String, 
    required: true,
    index: true 
  },
  date: { 
    type: String, // Format: YYYY-MM-DD
    required: true,
    index: true
  },
  totalSent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: 0 
  },
  limit: { 
    type: mongoose.Schema.Types.Decimal128, 
    required: true 
  }
});

// Compound index so we can look up a specific chain's daily total instantly
WalletStatsSchema.index({ chain: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('WalletStats', WalletStatsSchema);
