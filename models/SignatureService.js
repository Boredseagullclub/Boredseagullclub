const { ethers } = require('ethers');

function verifySwapSignature({
  walletAddress,
  fromToken,
  toToken,
  amount,
  nonce,
  signature
}) {

  const message = JSON.stringify({
    walletAddress,
    fromToken,
    toToken,
    amount,
    nonce
  });

  const recoveredAddress = ethers.verifyMessage(message, signature);

  return recoveredAddress.toLowerCase() === walletAddress.toLowerCase();
}

module.exports = { verifySwapSignature };
