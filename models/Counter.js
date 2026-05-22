// models/Counter.js
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g., "bridge_tag"
  seq: { type: Number, default: 1000 }    // Start at 1000 for a professional look
});

module.exports = mongoose.model('Counter', counterSchema);

