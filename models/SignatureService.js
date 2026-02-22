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
async function verifySwapSignature({ walletAddress, fromToken, toToken, amount, nonce, timestamp, signature, chain }) {
  if (!walletAddress || !fromToken || !toToken || !amount || !nonce || !timestamp || !signature || !chain) {
    throw new Error('Missing parameters for signature verification');
  }

  const message = buildSwapMessage({ walletAddress, fromToken, toToken, amount, chain, nonce, timestamp });

  switch (chain.toUpperCase()) {
    case 'FLR':
    case 'XDC':
      try {
        const recovered = ethers.verifyMessage(message, signature);
        return recovered.toLowerCase() === walletAddress.toLowerCase();
      } catch {
        return false;
      }

    case 'XRPL':
      try {
        return rippleKeypairs.verify(message, signature, walletAddress);
      } catch {
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
        return pubKey.verify(message, signature);
      } catch {
        return false;
      }

    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

module.exports = { verifySwapSignature, buildSwapMessage };
