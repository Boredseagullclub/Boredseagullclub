const express = require('express');
const router = express.Router();
const User = require('../models/User');

// 🦅 Fetch full sovereign profile by MongoDB ID
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Sovereign ID not found in Tank' });
    }
    // Returns balances, kycStatus, etc.
    res.json(user);
  } catch (err) {
    console.error("User Fetch Error:", err);
    res.status(500).json({ error: 'Internal Tank Error' });
  }
});

module.exports = router;
