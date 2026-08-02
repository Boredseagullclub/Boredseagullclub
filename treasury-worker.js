require('dotenv').config();
const xrpl = require('xrpl');

const WS_URL = process.env.XRPL_WS_URL || 'wss://xrplcluster.com';
const TREASURY_ADDRESS = 'rL9qvc9KhW7fX6eYtiw8a5HUEtYzGTYZcf';
const TREASURY_SECRET = process.env.TREASURY_SECRET ? process.env.TREASURY_SECRET.trim() : '';

if (!TREASURY_SECRET) {
    console.error("❌ FATAL: TREASURY_SECRET is missing or empty in environment variables.");
    process.exit(1);
}

// Master Collection Registry matching your front-end
const COLLECTION_REGISTRY = [
  { name: 'GENESIS', issuer: 'rftc7W745AzRikYjWDn669nCE4CNNttzcz', taxon: 23173 },
  { name: '2ND_EDITION', issuer: 'rnCVggVUH7F76JBKNEEASZB8QahfYzc6fT', taxon: 148407461 },
  { name: '3RD_EDITION', issuer: 'rKoREYA3cFXPbAUtfj1Y2duMMymuWpuNDE', taxon: 3 },
  { name: 'MANSIONS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 0 },
  { name: 'BUSINESS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 3 },
  { name: 'APARTMENTS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 2 },
  { name: 'HERON', issuer: 'rKoREYA3cFXPbAUtfj1Y2duMMymuWpuNDE', taxon: 1 },
  { name: 'SEAGULLVERSE', issuer: 'rnCVggVUH7F76JBKNEEASZB8QahfYzc6fT', taxon: 2 }
];

const wallet = xrpl.Wallet.fromMnemonic(TREASURY_SECRET);
const client = new xrpl.Client(WS_URL, {
    connectionTimeout: 15000,
    maxReconnectionAttempts: 10
});

async function auditTreasuryState(client) {
    console.log(`\n🔍 [AUDIT] Scanning treasury inventory and collection states...`);
    try {
        // 1. Get current treasury NFT inventory
        const nftsRes = await client.request({
            command: "account_nfts",
            account: TREASURY_ADDRESS
        }).catch(() => ({ result: { account_nfts: [] } }));

        const ownedNfts = nftsRes.result?.account_nfts || [];
        console.log(`📊 Treasury Inventory: Currently holding ${ownedNfts.length} NFT(s).`);

        // 2. PART A: PROCESS INCOMING STAKES (User -> Treasury)
        for (const collection of COLLECTION_REGISTRY) {
            const issuerNftsRes = await client.request({
                command: "account_nfts",
                account: collection.issuer
            }).catch(() => ({ result: { account_nfts: [] } }));

            const issuerNfts = issuerNftsRes.result?.account_nfts || [];
            
            // Taxon matching (handling taxon 0 properly)
            const matchedNfts = issuerNfts.filter(nft => {
                const t = nft.NFTokenTaxon ?? 0;
                return t === collection.taxon;
            });

            for (const nft of matchedNfts) {
                const nftId = nft.NFTokenID;
                if (!nftId) continue;
                if (ownedNfts.some(n => n.NFTokenID === nftId)) continue;

                let offers = [];
                try {
                    const offersRes = await client.request({
                        command: "nft_sell_offers",
                        nft_id: nftId
                    });
                    offers = offersRes.result?.offers || [];
                } catch (e) {
                    continue;
                }

                // Look for an active sell offer pointing directly to the treasury wallet
                const targetOffer = offers.find(offer => {
                    const dest = offer.destination || offer.Destination;
                    return dest === TREASURY_ADDRESS;
                });

                if (!targetOffer) continue;

                const offerIndex = targetOffer.nft_offer_index || targetOffer.index;
                console.log(`⚡ STAKE DETECTED! Accepting offer for NFT ${nftId} [Offer Index: ${offerIndex}]`);
                
                const ledgerIndex = await client.getLedgerIndex();
                const acceptTx = {
                    TransactionType: "NFTokenAcceptOffer",
                    Account: wallet.address,
                    NFTokenSellOffer: offerIndex,
                    LastLedgerSequence: ledgerIndex + 20
                };

                const result = await client.submitAndWait(acceptTx, { wallet });
                console.log(`✅ Intake Settled Successfully -> Result: ${result.result.meta.TransactionResult}`);
            }
        }

        // 3. PART B: AUDIT ACTIVE UNSTAKE OFFERS (Treasury $\rightarrow$ User)
        // Ensures treasury-held tokens with user return offers are tracked correctly
        for (const ownedNft of ownedNfts) {
            const nftId = ownedNft.NFTokenID;
            let sellOffers = [];
            try {
                const sRes = await client.request({
                    command: "nft_sell_offers",
                    nft_id: nftId
                });
                sellOffers = sRes.result?.offers || [];
            } catch (e) {
                continue;
            }

            const outboundOffer = sellOffers.find(o => {
                const ownerAcc = o.owner || o.account;
                const amt = o.amount || o.Amount;
                return ownerAcc === TREASURY_ADDRESS && amt === "0";
            });

            if (outboundOffer) {
                const recipient = outboundOffer.destination || outboundOffer.Destination;
                console.log(`📤 ACTIVE UNSTAKE OFFER: NFT ${nftId} is pending claim by user ${recipient}`);
            }
        }

    } catch (error) {
        console.error(`❌ Error during direct ledger scan cycle: ${error.message}`);
    }
}

async function startDaemon() {
    console.log(`🛡️ Direct-Scan Treasury Daemon Initialized.`);
    console.log(`🎯 Target Treasury: ${TREASURY_ADDRESS}`);

    while (true) {
        try {
            if (!client.isConnected()) {
                console.log("🔌 Connecting to XRPL cluster...");
                await client.connect();
                console.log("✅ Connected successfully.");
            }

            await auditTreasuryState(client);

        } catch (error) {
            console.error(`❌ Critical daemon loop failure: ${error.message}`);
            if (client.isConnected()) {
                await client.disconnect();
            }
        }

        console.log("⏳ Cycle complete. Sleeping for 30 seconds...\n");
        await sleep(59000);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

process.on('unhandledRejection', (err) => {
    console.error('⚠️ Unhandled Promise Rejection Caught:', err);
});

startDaemon();
