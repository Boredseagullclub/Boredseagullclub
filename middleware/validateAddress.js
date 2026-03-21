// middleware/validateAddress.js
const StellarSdk = require('stellar-sdk');
const { ethers } = require('ethers');
const Hedera = require('@hashgraph/sdk');
const logger = require('../utils/logger');

const ADDRESS_PATTERNS = {
  XRP:  /^r[rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz]{27,35}$/,
  XLM:  /^G[A-Z0-9]{55}$/,
  XDC:  /^xdc[0-9a-fA-F]{40}$/i,
  FLR:  /^0x[0-9a-fA-F]{40}$/i,
  HBAR: /^0\.0\.[1-9][0-9]*$/,
  ALGO: /^[A-Z0-9]{58}$/,
};

const validateAddress = (req, res, next) => {
  const { chain, destination: addr } = req.body;

  if (!chain || !addr) {
    return res.status(400).json({ error: 'chain and destination required' });
  }

  const upperChain = chain.toUpperCase();
  const pattern = ADDRESS_PATTERNS[upperChain];

  if (!pattern) {
    return res.status(400).json({ error: `Unsupported chain: ${chain}` });
  }

  if (!pattern.test(addr)) {
    logger.warn({
      module: 'AddressValidation',
      event: 'invalid_format',
      chain: upperChain,
      address: addr,
      ip: req.ip
    });
    return res.status(400).json({ error: `Invalid ${upperChain} address format` });
  }

  // Extra checksum where applicable
  try {
    if (upperChain === 'XLM') {
      StellarSdk.Keypair.fromPublicKey(addr); // throws on invalid
    } else if (['XDC', 'FLR'].includes(upperChain)) {
      if (!ethers.isAddress(addr)) {
        throw new Error('Invalid EVM checksum');
      }
    } else if (upperChain === 'HBAR') {
      Hedera.AccountId.fromString(addr); // throws on invalid
    }
    // XRPL & ALGO mostly rely on regex for now (no easy lightweight checksum lib)
  } catch (e) {
    logger.warn({
      module: 'AddressValidation',
      event: 'checksum_failed',
      chain: upperChain,
      address: addr,
      error: e.message
    });
    return res.status(400).json({ error: `Invalid ${upperChain} address (checksum failed)` });
  }

  next();
};

module.exports = validateAddress;
