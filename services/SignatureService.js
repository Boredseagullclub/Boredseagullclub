// services/SignatureService.js
const { ethers } = require('ethers');
const rippleKeypairs = require('ripple-keypairs');
const StellarSdk = require('stellar-sdk');
const { PublicKey } = require('@hashgraph/sdk');

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
 */
async function verifySwapSignature({ 
  walletAddress, 
  publicKey, // Required for XRPL verification
  signature, 
  fromToken, 
  toToken, 
  amount, 
  nonce, 
  timestamp, 
  chain 
}) {
  const message = buildSwapMessage({ walletAddress, fromToken, toToken, amount, chain, nonce, timestamp });

  switch (chain.toUpperCase()) {
    case 'FLR':
    case 'XDC':
      try {
        // V6: verifyMessage is a top-level export
        const recovered = ethers.verifyMessage(message, signature);
        return recovered.toLowerCase() === walletAddress.toLowerCase();
      } catch {
        return false;
      }

    case 'XRPL':
      try {
        // 1. Convert message to Hex for the ripple library
        const messageHex = Buffer.from(message).toString('hex');
        
        // 2. Verify signature against the HEX Public Key (not the r-address)
        const isValid = rippleKeypairs.verify(messageHex, signature, publicKey);
        if (!isValid) return false;

        // 3. Confirm the Public Key belongs to the walletAddress in our DB
        const derivedAddress = rippleKeypairs.deriveAddress(publicKey);
        return derivedAddress === walletAddress;
      } catch (err) {
        return false;
      }

    case 'XLM':
      try {
        const keypair = StellarSdk.Keypair.fromPublicKey(walletAddress);
        return keypair.verify(Buffer.from(message), Buffer.from(signature, 'hex'));
      } catch {
        return false;
      }

    case 'HBAR':
      try {
        const pubKey = PublicKey.fromString(walletAddress);
        return pubKey.verify(Buffer.from(message), signature);
      } catch {
        return false;
      }

    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

module.exports = { verifySwapSignature, buildSwapMessage };
