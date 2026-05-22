const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/user');

// 🦅 The Mailbox Bouncer: Verifies the Sumsub Signature
const verifySumsubSignature = (req) => {
  const signature = req.headers['x-payload-digest'];
  const secret = process.env.SUMSUB_SECRET_KEY; // Put this in your .env
  
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body)) // Sumsub sends JSON
    .digest('hex');

  return signature === hash;
};

// 🆔 The Webhook Route
router.post('/webhook/sumsub', async (req, res) => {
  try {
    // 1. Security Check
    if (!verifySumsubSignature(req)) {
      console.error("🛑 KYC ALERT: Unauthorized webhook attempt.");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const { externalUserId, type, reviewResult } = req.body;

    // We only care about "applicantReviewed" events
    if (type === 'applicantReviewed') {
      const isApproved = reviewResult.reviewAnswer === 'GREEN';
      const status = isApproved ? 'VERIFIED' : 'REJECTED';

      // 2. Update the Database
      await User.updateOne(
        { _id: externalUserId }, 
        { 
          kycStatus: status,
          'kycData.verifiedAt': isApproved ? new Date() : null,
          'kycData.providerId': req.body.applicantId
        }
      );

      console.log(`✅ KYC UPDATED: User ${externalUserId} is now ${status}`);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error("❌ KYC Webhook Error:", err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;

