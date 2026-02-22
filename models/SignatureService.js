const { ethers } = require('ethers');

function buildSwapMessage({
  walletAddress,
  fromToken,
  toToken,
  amount,
  nonce
}) {
  return `SEAGULL_SWAP:
wallet:${walletAddress}
from:${fromToken}
to:${toToken}
amount:${amount}
nonce:${nonce}`;
}

function verifySwapSignature({
  walletAddress,
  fromToken,
  toToken,
  amount,
  nonce,
  signature
}) {

  const message = buildSwapMessage({
    walletAddress,
    fromToken,
    toToken,
    amount,
    nonce
  });

  const recoveredAddress = ethers.verifyMessage(message, signature);

  return recoveredAddress.toLowerCase() === walletAddress.toLowerCase();
}

module.exports = {
  verifySwapSignature,
  buildSwapMessage
};
