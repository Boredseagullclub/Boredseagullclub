const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const walletRoutes = require('./routes/walletRoutes');
const logger = require('./utils/logger');
const { runConfirmationCycle } = require('./services/ConfirmationEngine');

const startEvmListener = require('./evmListener');
const startXrplListener = require('./xrplListener');


const app = express();
app.use(bodyParser.json());

/*
    MongoDB
*/
mongoose.connect('mongodb://localhost:27017/seagull', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('MongoDB connected');

  // Start deposit listeners after DB is ready
  startEvmListener("FLR").catch(console.error);
  startXrplListener().catch(console.error);

})
.catch(err => console.error('MongoDB connection error:', err));

/*
    API Routes
*/
app.use('/api', walletRoutes);

/*
    Deposit confirmation worker
*/
setInterval(() => {
  runConfirmationCycle()
    .catch(err => logger.error({ module: 'DepositEngine', error: err.message }));
}, 30000);

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Seagull Bridge running on port ${PORT}`);
});

module.exports = { app };
