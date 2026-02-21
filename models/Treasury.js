const mongoose = require('mongoose');

const treasurySchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  collectedFees: { type: Number, default: 0 }
});

module.exports = mongoose.model('Treasury', treasurySchema);
