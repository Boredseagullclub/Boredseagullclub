// services/SignatureService.js
const { ethers } = require('ethers');
const rippleKeypairs = require('ripple-keypairs');
const StellarSdk = require('stellar-sdk');
const { PublicKey } = require('@hashgraph/sdk');
const logger = require('../logger'); // assuming you have pino or similar

/**
 * Build a deterministic message for swap signing
 */
function buildSwapMessage({ walletAddress, fromToken, toToken, amount, chain, nonce, timestamp }) {
  return `SEAGULL_SWAP:
wallet:${walletAddress}
from:${fromToken}
to:${toToken}
amount:${amount}
chain:${chain}
nonce:${nonce}
timestamp:${timestamp}`;
}

/**
 * Verify a swap signature across multiple chains
 * @param {Object} params
 * @param {string} params.walletAddress - User's on-chain address (r..., 0x..., G..., etc.)
 * @param {string} [params.publicKey] - Hex public key — REQUIRED for XRPL
 * @param {string} params.signature - Signature provided by user
 * @returns {boolean}
 */
async function verifySwapSignature({
  walletAddress,
  publicKey,           // ← must be passed for XRPL
  signature,
  fromToken,
  toToken,
  amount,
  nonce,
  timestamp,
  chain
}) {
  if (!signature || !chain) {
    return false;
  }

  const message = buildSwapMessage({ walletAddress, fromToken, toToken, amount, chain, nonce, timestamp });

  const upperChain = chain.toUpperCase();

  switch (upperChain) {
    case 'FLR':
    case 'XDC': {
      try {
        const recovered = ethers.verifyMessage(message, signature);
        return recovered.toLowerCase() === walletAddress.toLowerCase();
      } catch {
        return false;
      }
    }

    case 'XRPL': {
      if (!publicKey) {
        logger.warn({ event: 'xrpl_sig_verify_missing_pubkey', walletAddress });
        return false;
      }

      try {
        const messageHex = Buffer.from(message).toString('hex');

        // ripple-keypairs expects hex public key (33 bytes → 66 hex chars)
        const isValid = rippleKeypairs.verify(messageHex, signature, publicKey);
        if (!isValid) return false;

        // Extra safety: make sure this pubkey actually belongs to the claimed address
        const derivedAddress = rippleKeypairs.deriveAddress(publicKey);
        if (derivedAddress !== walletAddress) {
          logger.warn({
            event: 'xrpl_pubkey_address_mismatch',
            claimed: walletAddress,
            derived: derivedAddress
          });
          return false;
        }

        return true;
      } catch (err) {
        logger.debug({
          event: 'xrpl_sig_verify_error',
          error: err.message,
          walletAddress
        });
        return false;
      }
    }

    case 'XLM': {
      try {
        const keypair = StellarSdk.Keypair.fromPublicKey(walletAddress);
        return keypair.verify(Buffer.from(message), Buffer.from(signature, 'hex'));
      } catch {
        return false;
      }
    }

    case 'HBAR': {
      try {
        const pubKey = PublicKey.fromString(walletAddress); // Hedera uses string format
        return pubKey.verify(Buffer.from(message), Buffer.from(signature, 'hex')); // note: Hedera sigs are usually DER or raw
      } catch {
        return false;
      }
    }

    default:
      logger.warn({ event: 'unsupported_chain_for_sig_verify', chain: upperChain });
      return false;
  }
}

module.exports = { verifySwapSignature, buildSwapMessage };
