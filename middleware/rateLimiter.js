const rateLimit = require('express-rate-limit');

// Protect the Bridge Intent - Max 5 intents per 15 minutes per IP
const bridgeIntentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 5, 
  message: { error: "Too many bridge requests. Chill out, Seagull." }
});

module.exports = { bridgeIntentLimiter };

