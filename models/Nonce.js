// models/Nonce.js
const mongoose = require('mongoose');

const nonceSchema = new mongoose.Schema({
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

nonceSchema.index({ walletAddress: 1, chain: 1 }, { unique: true });

module.exports = mongoose.model('Nonce', nonceSchema);
