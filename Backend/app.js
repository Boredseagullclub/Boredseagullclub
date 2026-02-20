
const express = require('express');
const bodyParser = require('body-parser');
const { SEAGULLCOIN, SEAGULLCASH, FEES } = require('./config');
const { executeSwap, getLiquidityThreshold } = require('./db/ledger');
const { getDynamicFee } = require('./ai/feeAgent');

const app = express();
app.use(bodyParser.json());

// Full swap endpoint (SeagullCoin + SeagullCash, dynamic AI fees)
app.post('/api/swap', async (req, res) => {
    try {
        const { userId, fromPool, toPool, amount } = req.body;

        if (!userId || !fromPool || !toPool || !amount) {
            return res.status(400).send({ error: 'Missing fields' });
        }

        // Determine which family the token belongs to
        let family;
        if (SEAGULLCOIN[fromPool]) family = 'SEAGULLCOIN';
        else if (SEAGULLCASH[fromPool]) family = 'SEAGULLCASH';
        else return res.status(400).send({ error: 'Unknown token pool' });

        // Get baseline fee for this family
        const baselineFee = FEES[family];

        // Apply dynamic AI fee only if swap exceeds liquidity threshold
        let finalFee = baselineFee;
        const threshold = getLiquidityThreshold(fromPool); // returns number
        if (amount > threshold) {
            const aiAdjustment = await getDynamicFee(userId, fromPool, toPool, amount, family);
            finalFee = baselineFee + aiAdjustment;
        }

        // Execute swap with the correct fee
        const result = await executeSwap(userId, fromPool, toPool, amount, finalFee);

        if (!result.success) return res.status(400).send({ error: result.message });

        res.send(result);
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Internal server error' });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
