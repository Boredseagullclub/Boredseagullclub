// models/IsoMessage.js
const mongoose = require('mongoose');

const IsoMessageSchema = new mongoose.Schema({
  txHash: { type: String, required: true, unique: true }, // The on-chain proof
  chain: { type: String, required: true },               // Flare, XDC, XRPL, XLM
  messageType: { type: String, default: 'pacs.008' },    // Customer Credit Transfer
  
  // 🦅 INSTITUTIONAL CORE FIELDS
  endToEndId: { type: String, required: true },          // ISO Mandatory: Unique ID
  instructionId: { type: String },                       // Tracking ID for banks
  purposeCode: { type: String, default: 'OTHR' },        // e.g., 'SALA' (Salary), 'TREA' (Treasury)
  
  // 🏦 COUNTERPARTY DATA
  debtor: {
    name: String,
    address: String, // Wallet address
    agent: String    // The "Bank" or "Node" used
  },
  creditor: {
    name: String,
    address: String,
    agent: String
  },

  remittanceInfo: { type: String }, // The Invoice # or Memo
  rawXml: { type: String },         // Original ISO 20022 XML for audit
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('IsoMessage', IsoMessageSchema);
