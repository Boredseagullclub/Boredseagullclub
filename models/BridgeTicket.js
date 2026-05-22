const BridgeTicketSchema = new mongoose.Schema({
    userId: String,           // The 0x address
    fromChain: String,
    toChain: String,
    amount: String,
    symbol: String,
    destinationAddress: String,
    depositAddress: String,
    memo: String,             // 🦅 THE MASTER KEY
    status: { 
      type: String, 
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'], 
      default: 'PENDING' 
    },
    createdAt: { 
      type: Date, 
      default: Date.now,
      index: { expires: '12h' } // 🦅 AUTO-DELETE after 12 hours
    }
});

const BridgeTicket = mongoose.model('BridgeTicket', BridgeTicketSchema);

