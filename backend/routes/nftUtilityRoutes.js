const express = require('express');
const router = express.Router();
const xrpl = require('xrpl');
const mongoose = require('mongoose');

const COLLECTIONS = [
  { name: 'GENESIS', issuer: 'rftc7W745AzRikYjWDn669nCE4CNNttzcz', taxon: 0 },
  { name: '2ND_EDITION', issuer: 'rnCVggVUH7F76JBKNEEASZB8QahfYzc6fT', taxon: 148407461 },
  { name: '3RD_EDITION', issuer: 'rKoREYA3cFXPbAUtfj1Y2duMMymuWpuNDE', taxon: 3 },
  { name: 'MANSIONS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 0 },
  { name: 'BUSINESS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 3 },
  { name: 'APARTMENTS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 0 },
  { name: 'HERON', issuer: 'rKoREYA3cFXPbAUtfj1Y2duMMymuWpuNDE', taxon: 1 },
  { name: 'SEAGULLVERSE', issuer: 'rnCVggVUH7F76JBKNEEASZB8QahfYzc6fT', taxon: 2 }
];

router.get('/check/:address', async (req, res) => {
  const { address } = req.params;

  try {
    // 1. Look up the user by ANY of their addresses
    const User = mongoose.models.User || mongoose.model('User');
    const user = await User.findOne({
        $or: [
            { publicAddress: address },
            { walletAddress: address },
            { 'wallets.evm': address },
            { 'wallets.xrpl': address },
            { 'wallets.stellar': address }
        ]
    });

    // 2. Extract the true XRPL address
    let xrplAddr = user?.wallets?.xrpl || (address.startsWith('r') ? address : null);

    // If they have no XRPL address associated, return empty holdings cleanly
    if (!xrplAddr) {
      return res.json({ success: true, holdings: [] });
    }

    // 3. Query the ledger using the DERIVED XRPL address, not the raw param
    const client = new xrpl.Client('wss://xrplcluster.com');
    await client.connect();
    const response = await client.request({
      command: 'account_nfts',
      account: xrplAddr
    });

    const rawNfts = response.result.account_nfts || [];

    const holdings = rawNfts.map(nft => {
      const collection = COLLECTIONS.find(c => c.issuer === nft.Issuer && c.taxon === nft.NFTokenTaxon);
      return {
        id: nft.NFTokenID,
        name: collection ? collection.name : `UNKNOWN (${nft.Issuer.slice(0,6)})`,
        taxon: nft.NFTokenTaxon,
        issuer: nft.Issuer
      };
    });

    await client.disconnect();
    res.json({ success: true, holdings });

  } catch (err) {
    console.error("Ledger Query Error:", err.message);
    res.status(500).json({ success: false, message: `Ledger scan failed: ${err.message}` });
  }
});

module.exports = router;
