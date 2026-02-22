const { ethers } = require('ethers');
const rippleKeypairs = require('ripple-keypairs');
const StellarSdk = require('stellar-sdk');
const { PublicKey } = require('@hashgraph/sdk');

/**
 * Verify a swap signature across multiple chains.
 * Supports:
 * - ECDSA: FLR, XDC
 * - Ed25519: XRPL, XLM, HBAR
 * 
 * @param {Object} params
 * @param {string} params.walletAddress - User's public address
 * @param {string} params.fromToken - Token being swapped
 * @param {string} params.toToken - Token being received
 * @param {number|string} params.amount - Amount of fromToken
 * @param {number} params.nonce - Nonce for replay protection
 * @param {string} params.signature - Signed message
 * @param {string} params.chain - Blockchain: 'FLR', 'XDC', 'XRPL', 'XLM', 'HBAR'
 * @returns {boolean} true if signature is valid
 */
async function verifySwapSignature({
  walletAddress,
  fromToken,
  toToken,
  amount,
  nonce,
  timestamp,
  signature,
  chain
}) {
  // Serialize message consistently
  const message = JSON.stringify({ walletAddress, fromToken, toToken, amount, nonce });

  switch (chain.toUpperCase()) {
    case 'FLR':
    case 'XDC':
      // ECDSA verification using ethers
      try {
        const recovered = ethers.verifyMessage(message, signature);
        return recovered.toLowerCase() === walletAddress.toLowerCase();
      } catch {
        return false;
      }

    case 'XRPL':
      // Ed25519 verification using ripple-keypairs
      try {
        return rippleKeypairs.verify(message, signature, walletAddress);
      } catch {
        return false;
      }

    case 'XLM':
      // Ed25519 verification using stellar-sdk
      try {
        const keypair = StellarSdk.Keypair.fromPublicKey(walletAddress);
        return keypair.verify(Buffer.from(message), Buffer.from(signature, 'hex'));
      } catch {
        return false;
      }

    case 'HBAR':
      // Ed25519 verification using hashgraph SDK
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

module.exports = { verifySwapSignature };
