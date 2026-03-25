// config.js  (improved version of your first one)
module.exports = {
  CHAINS: {
    XRP: { type: "XRPL", nativeSymbol: "XRP", decimals: 6, atomicUnit: "drops" },
    XDC: { type: "EVM",  nativeSymbol: "XDC", decimals: 18, atomicUnit: "wei" },
    FLR: { type: "EVM",  nativeSymbol: "FLR", decimals: 18, atomicUnit: "wei" },
    XLM: { type: "STELLAR", nativeSymbol: "XLM", decimals: 7, atomicUnit: "stroops" },
    HBAR: { type: "HEDERA", nativeSymbol: "HBAR", decimals: 8, atomicUnit: "tinybar" },
    ALGO: { type: "ALGORAND", nativeSymbol: "ALGO", decimals: 6, atomicUnit: "microalgo" }
  },

  TOKENS: {
    SEAGULLCOIN: {
      symbol: "SEAGULLCOIN",
      networks: {
        XRP: { issuer: "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno", decimals: 6 },
        XDC: { contract: "0xd38109f587bd0326cad60a18cf3c1ecd546809a6", decimals: 18 },
        FLR: { contract: "0x495dafa49ed19f3bfc3ddeb7e048f20ff149778f", decimals: 18 }
      }
    },
    SEAGULLCASH: {
      symbol: "SEAGULLCASH",
      networks: {
        XRP: { issuer: "rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK", decimals: 6 },
        XLM: { issuer: "GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7", decimals: 7 },
        HBAR: { issuer: "0.0.3116734", decimals: 8 },
        ALGO: { issuer: "EEFJ2OW6ITKQ46QGS5THTLA2LDPE5P64YHPBPSR4XOFCDQ44ODCQG37G7U", decimals: 6 }
      }
    }
  },

  DAILY_LIMITS: {  // ← Add this for quotaGuard
    XRP: "10000",
    XDC: "5000",
    FLR: "5000",
    XLM: "10000",
    HBAR: "10000",
    SEAGULLCOIN: "250000",
      SEAGULLCASH: "1000000"
  },

  FEES: {
    SEAGULLCOIN: 0.025,
    SEAGULLCASH: 0.01
  }
};
