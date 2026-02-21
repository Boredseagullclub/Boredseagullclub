const mongoose = require('mongoose');

const poolSchema = new mongoose.Schema({
  tokenA: { type: String, required: true },
  tokenB: { type: String, required: true },
  reserves: {
    type: Map,
    of: Number,
    default: {}
  }
});

module.exports = mongoose.model('Pool', poolSchema);
