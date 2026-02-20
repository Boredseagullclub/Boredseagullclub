
const express = require('express');
const bodyParser = require('body-parser');
const swapRoute = require('./routes/swap');

const app = express();
app.use(bodyParser.json());

app.use('/api/swap', swapRoute);

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
