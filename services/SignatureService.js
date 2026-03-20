// services/SignatureService.js
const { ethers } = require('ethers');

async function verifySwapSignature({ walletAddress, signature, ...params }) {
  const message = buildSwapMessage({ walletAddress, ...params });

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
    // ... XRPL/XLM/HBAR cases remain the same
  }
}
