
const express = require('express');
const router = express.Router();
const ledger = require('../db/ledger');

router.post('/', async (req, res) => {
    const { userId, fromPool, toPool, amount } = req.body;

    if (!userId || !fromPool || !toPool || !amount) {
        return res.status(400).send({ error: 'Missing fields' });
    }

    const result = ledger.executeSwap(userId, fromPool, toPool, amount);

    if (!result.success) return res.status(400).send({ error: result.message });

    res.send(result);
});

module.exports = router;
