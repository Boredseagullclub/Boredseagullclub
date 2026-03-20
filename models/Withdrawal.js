const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  token: { 
    type: String, 
    required: true 
  },
  amount: { 
    type: mongoose.Schema.Types.Decimal128, 
    required: true 
  },
  toAddress: { 
    type: String, 
    required: true 
  },
  chain: { 
    type: String, 
    required: true,
    enum: ['XRP', 'XLM', 'XDC', 'FLR', 'HBAR', 'ALGO'] 
  },
  status: { 
    type: String, 
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'], 
    default: 'PENDING',
    index: true
  },
  txHash: { 
    type: String, 
    unique: true, 
    sparse: true // Allows nulls until the TX is actually sent
  },
  error: { 
    type: String 
  },
  attempts: { 
    type: Number, 
    default: 0 
  }
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);
