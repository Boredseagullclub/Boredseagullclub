// models/AccountNonce.js
const mongoose = require('mongoose');

const accountNonceSchema = new mongoose.Schema({
  walletAddress: { 
    type: String, 
    required: true, 
    lowercase: true, 
    trim: true 
  },
  chain: { 
    type: String, 
    required: true, 
    uppercase: true 
  },
  nextNonce: { 
    type: Number, 
    required: true, 
    default: 0,
    min: 0
  },
}, { 
  timestamps: true 
});

accountNonceSchema.index({ walletAddress: 1, chain: 1 }, { unique: true });

module.exports = mongoose.model('AccountNonce', accountNonceSchema);
