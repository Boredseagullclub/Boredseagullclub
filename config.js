// config.js
module.exports = {
    SEAGULLCOIN: {
        XRP: { type: "XRP", issuer: "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno" },
        XDC: { type: "EVM", contract: "0xd38109f587bd0326cad60a18cf3c1ecd546809a6" },
        FLR: { type: "EVM", contract: "0x495dafa49ed19f3bfc3ddeb7e048f20ff149778f" },
    },
    SEAGULLCASH: {
        XRP: { type: "XRP", issuer: "rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK" },
        XLM: { type: "XLM", issuer: "GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7" },
        HBAR: { 
            type: "HBAR", 
            issuer: "0.0.3116734", 
            evm: "0x00000000000000000000000000000000002f8ebe"
        },
        ALGO: { type: "ALGO", issuer: "EEFJ2OW6ITKQ46QGS5THTLA2LDPE5P64YHPBPSR4XOFCDQ44ODCQG37G7U" }
    },
    FEES: {
        SEAGULLCOIN: 0.025, // 2.5%
        SEAGULLCASH: 0.01    // 1%
    }
};
