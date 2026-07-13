const xrpl = require('xrpl');
const { ethers } = require('ethers');
const mongoose = require('mongoose');
const { getTopBalances } = require('./RichlistSorter');

// Master image anchors mapping to your frontend dictionary keys
const LOGOS = {
    XRP:  'https://files.catbox.moe/kl2ii3.png',
    XLM:  'https://files.catbox.moe/evgd8n.png',
    HBAR: 'https://files.catbox.moe/ixe2t4.jpg',
    FLR:  'https://files.catbox.moe/q0eg3r.png',
    XDC:  'https://files.catbox.moe/6k7cu1.jpg',
    SGC:  'https://files.catbox.moe/utrpfc.png',
    SGCSH: 'https://files.catbox.moe/w3cets.png'
};

/**
 * Universal Scouter Core Engine
 * Aggregates Live Network States, Native Ledgers, Enterprise ISO Documents & True System Richlist
 */
async function executeMultiChainScout(address) {
    const scoutReport = [];
    let discoveredTransactions = [];
    const scanTasks = [];

    // Clean and validate target input identity
    if (!address) return { identityReport: [], globalMetrics: { sgcTopBalances: [], sgcshTopBalances: [] } };
    let cleanAddress = address.trim();

    // =============================================================
    // PREFIX NORMALIZATION LAYER: Standardize xdc prefixes to 0x for core EVM providers
    // =============================================================
    let evmSearchAddress = cleanAddress;
    if (cleanAddress.toLowerCase().startsWith('xdc')) {
        evmSearchAddress = '0x' + cleanAddress.slice(3);
    }

    // =============================================================
    // 1. ENGINE PHASE A: LIVE NETWORK SCANS (BALANCES & NATIVE HISTORY)
    // =============================================================

    // --- CASE A: XRPL IDENTS ---
    if (cleanAddress.startsWith('r')) {
        scanTasks.push((async () => {
            const XRPL_NODES = ["wss://s2.ripple.com", "wss://xrpl.ws", "wss://s1.ripple.com"];
            for (const nodeUrl of XRPL_NODES) {
                try {
                    const client = new xrpl.Client(nodeUrl, { connectionTimeout: 4000 });
                    await client.connect();

                    // Live XRP Drops
                    const accountInfo = await client.request({ command: "account_info", account: cleanAddress, ledger_index: "validated" });
                    const xrpBalance = xrpl.dropsToXrp(accountInfo.result.account_data.Balance);
                    scoutReport.push({
                        name: 'XRP', symbol: 'XRP', ticker: 'XRP', chain: 'XRPL',                                                                         
                        balance: xrpBalance, issuer: 'Native', logo: LOGOS.XRP
                    });

                    // Live Token Trustlines
                    try {
                        const linesInfo = await client.request({ command: "account_lines", account: cleanAddress, ledger_index: "validated" });
                        for (const line of linesInfo.result.lines) {
                            if (parseFloat(line.balance) === 0) continue;

                            let assetName = null; let assetTicker = line.currency; let assetLogo = LOGOS.XRP;
                            if (line.account === 'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno' || line.currency === 'SGC' || line.currency === 'SEAGULLCOIN') {
                                assetName = 'SeagullCoin'; assetTicker = 'SGC'; assetLogo = LOGOS.SGC;
                            } else if (line.account === 'rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK' || line.currency === 'SGCSH' || line.currency === 'SGH' || line.currency === 'SEAGULLCASH') {
                                assetName = 'SeagullCash'; assetTicker = 'SGCSH'; assetLogo = LOGOS.SGCSH;
                            }
                            if (assetName) {
                                let rawBal = String(line.balance);
                                if (rawBal.includes('e-') || rawBal.includes('E-')) {
                                    rawBal = Number(line.balance).toFixed(6);
                                }
                                scoutReport.push({
                                    name: assetName, symbol: assetTicker, ticker: assetTicker, chain: 'XRPL',
                                    balance: rawBal, issuer: line.account, logo: assetLogo
                                });
                            }
                        }
                    } catch (e) { console.log("ℹ️ No custom token lines mapped on XRPL."); }

                    // Scrape live native peer-to-peer ledger history directly from the node
                    try {
                        const txHistory = await client.request({ command: "account_tx", account: cleanAddress, limit: 20 });
                        if (txHistory.result.transactions) {
                            txHistory.result.transactions.forEach(item => {
                                const tx = item.tx;
                                if (tx.TransactionType === "Payment") {
                                    const isSend = tx.Account === cleanAddress;
                                    const rawAmount = typeof tx.Amount === 'string' ? xrpl.dropsToXrp(tx.Amount) : tx.Amount.value;
                                    let tokenTicker = typeof tx.Amount === 'string' ? 'XRP' : tx.Amount.currency;
                                    if (tokenTicker === 'SGH' || tokenTicker === 'SEAGULLCASH') tokenTicker = 'SGCSH';
                                    if (tokenTicker === 'SEAGULLCOIN') tokenTicker = 'SGC';
                                    discoveredTransactions.push({
                                        hash: tx.hash, uetr: 'N/A (NATIVE BASE LAYER)',
                                        type: isSend ? 'SEND' : 'RECEIVE',
                                        intent: isSend ? 'TRANSFER OUT' : 'TRANSFER IN',
                                        chain: 'XRPL', messageType: 'NATIVE_ONCHAIN_TRANSFER', amount: String(rawAmount), currency: tokenTicker,
                                        counterparty: isSend ? tx.Destination : tx.Account,
                                        remittanceInfo: `Direct peer-to-peer ledger movement cleared on XRPL core.`,
                                        timestamp: new Date().toLocaleString()
                                    });
                                }
                            });
                        }
                    } catch (txErr) { console.warn(`⚠️ Live XRPL ledger walk failed: ${txErr.message}`); }
                    await client.disconnect();
                    break;
                } catch (err) { console.warn(`⚠️ Failover bypassing XRPL gate: ${nodeUrl}`); }
            }
        })());
    }

    // --- CASE B: STELLAR IDENTS ---
    if (cleanAddress.startsWith('G') && cleanAddress.length === 56) {
        scanTasks.push((async () => {
            try {
                const response = await fetch(`https://horizon.stellar.org/accounts/${cleanAddress}`);
                if (response.status === 200) {
                    const accountData = await response.json();
                    for (const bal of accountData.balances) {
                        const codeNormalized = String(bal.asset_code || '').toUpperCase();
                        if (bal.asset_type === 'native') {
                            scoutReport.push({ name: 'XLM', symbol: 'XLM', ticker: 'XLM', chain: 'STELLAR', balance: parseFloat(bal.balance).toFixed(4), issuer: 'Native', logo: LOGOS.XLM });
                        } else if (codeNormalized === 'SEAGULLCASH' || codeNormalized === 'SGCSH' || bal.asset_issuer === 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPD') {
                            scoutReport.push({ name: 'SeagullCash', symbol: 'SGCSH', ticker: 'SGCSH', chain: 'STELLAR', balance: parseFloat(bal.balance).toFixed(4), issuer: bal.asset_issuer || 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPD', logo: LOGOS.SGCSH });
                        } else if (codeNormalized === 'SEAGULLCOIN' || codeNormalized === 'SGC') {
                            scoutReport.push({ name: 'SeagullCoin', symbol: 'SGC', ticker: 'SGC', chain: 'STELLAR', balance: parseFloat(bal.balance).toFixed(4), issuer: bal.asset_issuer, logo: LOGOS.SGC });
                        }
                    }

                    // Gather payment history from Horizon
                    try {
                        const historyRes = await fetch(`https://horizon.stellar.org/accounts/${cleanAddress}/payments?limit=40&order=desc`);
                        if (historyRes.status === 200) {
                            const historyData = await historyRes.json();
                            historyData._embedded.records.forEach(op => {
                                if (op.type === 'payment') {
                                    // 🦅 1. FILTER OUT NOISE: Skip microscopic/dust transactions that round to 0
                                    if (parseFloat(op.amount) < 0.01) return;

                                    const isSend = op.from === cleanAddress;
                                    let tokenTicker = op.asset_type === 'native' ? 'XLM' : op.asset_code;
                                    if (tokenTicker === 'SEAGULLCASH') tokenTicker = 'SGCSH';
                                    if (tokenTicker === 'SEAGULLCOIN') tokenTicker = 'SGC';

                                    // 🦅 2. STRICT CURRENCY CHECK: Only load transactions for specific assets
                                    const allowedCurrencies = ['XLM', 'SGC', 'SGCSH'];
                                    if (!allowedCurrencies.includes(tokenTicker)) return;

                                    discoveredTransactions.push({
                                        hash: op.transaction_hash, uetr: 'N/A (NATIVE BASE LAYER)',
                                        type: isSend ? 'SEND' : 'RECEIVE',
                                        intent: isSend ? 'TRANSFER OUT' : 'TRANSFER IN',
                                        chain: 'STELLAR', messageType: 'NATIVE_ONCHAIN_TRANSFER', amount: String(op.amount), currency: tokenTicker,
                                        counterparty: isSend ? op.to : op.from,
                                        remittanceInfo: `Direct peer-to-peer operation settled on Stellar Horizon.`,
                                        timestamp: new Date(op.created_at).toLocaleString()
                                    });
                                }
                            });
                        }
                    } catch (historyErr) { console.warn(`⚠️ Horizon operations lookups failed: ${historyErr.message}`); }
                }
            } catch (e) { console.warn(`⚠️ Stellar live stream bypassed: ${e.message}`); }
        })());
    }

    // --- CASE C: HEDERA L1 NATURAL ADDRS ---
    if ((cleanAddress.startsWith('0.0.') && !cleanAddress.includes('-')) || cleanAddress.length < 12) {
        scanTasks.push((async () => {
            const HEDERA_NODES = [
                `https://mainnet-public.mirrornode.hbar.dev/api/v1/accounts/${cleanAddress}`,
                `https://mainnet.mirrornode.hedera.com/api/v1/accounts/${cleanAddress}`
            ];
            for (const endpoint of HEDERA_NODES) {
                try {
                    const response = await fetch(endpoint, { signal: AbortSignal.timeout(3500) });
                    if (response.status === 200) {
                        const hbarData = await response.json();
                        const nativeHbar = (parseInt(hbarData.balance.balance) / 100000000).toFixed(4);

                        scoutReport.push({ name: 'Native HBAR', symbol: 'HBAR', ticker: 'HBAR', chain: 'HEDERA', balance: nativeHbar, issuer: 'Native', logo: LOGOS.HBAR });

                        if (hbarData.balance.tokens && Array.isArray(hbarData.balance.tokens)) {
                            for (const token of hbarData.balance.tokens) {
                                if (token.token_id === "0.0.3115556") {
                                    scoutReport.push({ name: 'SeagullCash', symbol: 'SGCSH', ticker: 'SGCSH', chain: 'HEDERA', balance: (parseInt(token.balance) / 1000000).toFixed(4), issuer: token.token_id, logo: LOGOS.SGCSH });
                                }
                            }
                        }
                        break;
                    }
                } catch (e) { console.warn(`⚠️ Hedera mirror skip line.`); }
            }
        })());
    }

    // --- CASE D: SOLID EVM HEX ADDRESS SCANS (FLARE, XDC, HEDERA EVM SPACE) ---
    if (evmSearchAddress.startsWith('0x') && evmSearchAddress.length === 42) {
        scanTasks.push((async () => {
            const EVM_NETWORKS = {
                'FLARE': { id: 14, endpoints: ['https://flare.public-rpc.com', 'https://rpc.ankr.com/flare'], nativeTicker: 'FLR', contracts: { SGC: '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f' } },
                'XDC': { id: 50, endpoints: ['https://rpc.xdc.org', 'https://50.rpc.thirdweb.com/'], nativeTicker: 'XDC', contracts: { SGC: '0xd38109f587bd0326cad60a18cf3c1ecd546809a6' } },
                'HEDERA': { id: 295, endpoints: ['https://mainnet.hashgraph.io/api/v1/jsonrpc'], nativeTicker: 'HBAR', contracts: { SGCSH: '0x00000000000000000000000000000000002f8a24' } }
            };
            const erc20Abi = ["function balanceOf(address owner) view returns (uint256)"];

            await Promise.all(Object.entries(EVM_NETWORKS).map(async ([chain, nConfig]) => {
                let settled = false;
                for (const url of nConfig.endpoints) {
                    if (settled) break;
                    try {
                        const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: ethers.Network.from(nConfig.id) });
                        const bal = await Promise.race([
                            provider.getBalance(evmSearchAddress),
                            new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 2200))
                        ]);

                        const ethBal = chain === 'HEDERA' ? (Number(bal) / 100000000).toFixed(4) : ethers.formatEther(bal);
                        settled = true;

                        if (parseFloat(ethBal) > 0) {
                            scoutReport.push({ name: `Native ${chain}`, symbol: nConfig.nativeTicker, ticker: nConfig.nativeTicker, chain: chain, balance: ethBal, issuer: 'Native', logo: LOGOS[nConfig.nativeTicker] });
                        }
                        if (nConfig.contracts) {
                            if (nConfig.contracts.SGC) {
                                const contract = new ethers.Contract(nConfig.contracts.SGC, erc20Abi, provider);
                                const sgcBal = ethers.formatUnits(await contract.balanceOf(evmSearchAddress), 18);
                                if (parseFloat(sgcBal) > 0) scoutReport.push({ name: 'SeagullCoin', symbol: 'SGC', ticker: 'SGC', chain: chain, balance: sgcBal, issuer: nConfig.contracts.SGC, logo: LOGOS.SGC });
                            }
                            if (nConfig.contracts.SGCSH) {
                                const contract = new ethers.Contract(nConfig.contracts.SGCSH, erc20Abi, provider);
                                const sghBal = ethers.formatUnits(await contract.balanceOf(evmSearchAddress), 6);
                                if (parseFloat(sghBal) > 0) scoutReport.push({ name: 'SeagullCash', symbol: 'SGCSH', ticker: 'SGCSH', chain: chain, balance: sghBal, issuer: nConfig.contracts.SGCSH, logo: LOGOS.SGCSH });
                            }
                        }
                    } catch (e) { /* Soft failover proxy bypass */ }
                }
            }));
        })());
    }
    await Promise.all(scanTasks);

    // =============================================================
    // 2. ENGINE PHASE B: HIGH-INTELLIGENCE ISO INTERBANK MESSAGE INGESTION
    // =============================================================
    try {
        // 🦅 FIXED: Now strictly pointing to the live 'iso_messages' bridge output!
        const rawIsoRecords = await mongoose.connection.db.collection('iso_messages')
            .find({
                $or: [
                    { sender: cleanAddress }, { receiver: cleanAddress },
                    { debtorAccount: cleanAddress }, { creditorAccount: cleanAddress },
                    { sender: evmSearchAddress }, { receiver: evmSearchAddress },
                    { debtorAccount: evmSearchAddress }, { creditorAccount: evmSearchAddress },
                    { remittanceInfo: new RegExp(cleanAddress, 'i') }
                ]
            })
            .sort({ timestamp: -1 }).limit(40).toArray();

        rawIsoRecords.forEach(doc => {
            const checkAddr = cleanAddress.toLowerCase();
            const checkEvm = evmSearchAddress.toLowerCase();
            const isSend = (
                String(doc.sender).toLowerCase() === checkAddr ||
                String(doc.debtorAccount).toLowerCase() === checkAddr ||
                String(doc.sender).toLowerCase() === checkEvm ||
                String(doc.debtorAccount).toLowerCase() === checkEvm
            );

            let cleanCurrency = String(doc.currency || 'SGC').toUpperCase();
            if (cleanCurrency.includes('CASH') || cleanCurrency.includes('SGH')) cleanCurrency = 'SGCSH';
            if (cleanCurrency.includes('COIN')) cleanCurrency = 'SGC';

            let determinedIntent = isSend ? 'TRANSFER OUT' : 'TRANSFER IN';
            const memoString = String(doc.remittanceInfo || doc.memo || '').toUpperCase();
            const typeString = String(doc.type || '').toUpperCase();
            if (memoString.includes('SWAP') || typeString.includes('SWAP')) {
                determinedIntent = isSend ? 'SWAP OUT' : 'SWAP IN';
            }

            discoveredTransactions.push({
                hash: doc.txHash || doc.hash || 'UNKNOWN-HASH',
                uetr: doc.uetr || 'N/A (DIRECT L2 LAYER)',
                type: isSend ? 'SEND' : 'RECEIVE',
                intent: determinedIntent,
                chain: (doc.chain || 'XRPL').toUpperCase(),
                messageType: doc.messageType || 'pacs.008',
                amount: String(doc.amount || '0.00'),
                currency: cleanCurrency,
                counterparty: isSend ? (doc.receiver || doc.creditorAccount || 'Bridge Anchor Gateway') : (doc.sender || doc.debtorAccount || 'Bridge Anchor Gateway'),
                remittanceInfo: doc.remittanceInfo || 'ISO 20022 Multi-Chain Financial Ingestion Record',
                timestamp: doc.timestamp ? new Date(doc.timestamp).toLocaleString() : new Date().toLocaleString(),
                rawPayload: doc
            });
        });
    } catch (e) { console.warn(`⚠️ ISO database querying skipped: ${e.message}`); }

    // =============================================================
    // 3. ENGINE PHASE C: CACHED SYSTEM DEPOSITS HISTORICAL FEED
    // =============================================================
    try {
        const directDeposits = await mongoose.connection.db.collection('deposits')
            .find({
                $or: [
                    { walletAddress: cleanAddress.toLowerCase() },
                    { walletAddress: evmSearchAddress.toLowerCase() }
                ]
            })
            .sort({ txTimestamp: -1 }).limit(20).toArray();

        directDeposits.forEach(dep => {
            if (!discoveredTransactions.some(h => h.hash.toLowerCase() === dep.txHash.toLowerCase())) {
                let cleanToken = String(dep.token || 'SGC').toUpperCase();
                if (cleanToken.includes('CASH') || cleanToken === 'SGH') cleanToken = 'SGCSH';

                discoveredTransactions.push({
                    hash: dep.txHash, uetr: 'N/A (NATIVE DEPOSIT ENTRY)',
                    type: 'RECEIVE',
                    intent: 'TRANSFER IN',
                    chain: (dep.chain || 'FLARE').toUpperCase(), messageType: 'NATIVE_ONCHAIN_TRANSFER',
                    amount: dep.amount ? dep.amount.toString() : '0.00', currency: cleanToken,
                    counterparty: dep.walletAddress || 'Platform Processing Vault',
                    remittanceInfo: `Direct on-chain same-chain settlement logged by gateway daemon.`,
                    timestamp: dep.txTimestamp ? new Date(dep.txTimestamp).toLocaleString() : new Date().toLocaleString(),
                    rawPayload: { note: "On-Chain Transaction Log", status: dep.status }
                });
            }
        });
    } catch (e) { console.warn("⚠️ System internal logs step bypassed."); }

    // =============================================================
    // 4. ENGINE PHASE D: REAL ECOSYSTEM RICHLIST (STATE-BASED HOLDINGS)
    // =============================================================
    let richlistMetrics = { sgcTopBalances: [], sgcshTopBalances: [] };
    try {
        // 🏛️ TRACK 1: SEAGULLCOIN (SGC) MULTI-CHAIN UNIFICATION (Top 100)
        const xrplSgc = await getTopBalances('XRPL', 'SGC', 100);
        const xdcSgc = await getTopBalances('XDC', 'SGC', 100);
        const flareSgc = await getTopBalances('FLARE', 'SGC', 100);

        let masterSgcPool = [
            ...xrplSgc.map(u => ({ wallet: u.walletAddress, balance: parseFloat(u.balance || 0), chain: 'XRPL' })),
            ...xdcSgc.map(u => ({ wallet: u.walletAddress, balance: parseFloat(u.balance || 0), chain: 'XDC' })),
            ...flareSgc.map(u => ({ wallet: u.walletAddress, balance: parseFloat(u.balance || 0), chain: 'FLARE' }))
        ];

        masterSgcPool.sort((a, b) => b.balance - a.balance);

        richlistMetrics.sgcTopBalances = masterSgcPool.slice(0, 300).map(u => ({
            wallet: u.wallet || 'Internal Account',
            balance: String(u.balance || "0.00"),
            chain: u.chain
        }));

        // 🏛️ TRACK 2: SEAGULLCASH (SGCSH) MULTI-CHAIN UNIFICATION (Top 100)
        const xrplCash = await getTopBalances('XRPL', 'SGCSH', 100);
        const hederaCash = await getTopBalances('HEDERA', 'SGCSH', 100);
        const stellarCash = await getTopBalances('STELLAR', 'SGCSH', 100);

        let masterCashPool = [
            ...xrplCash.map(u => ({ wallet: u.walletAddress, balance: parseFloat(u.balance || 0), chain: 'XRPL' })),
            ...hederaCash.map(u => ({ wallet: u.walletAddress, balance: parseFloat(u.balance || 0), chain: 'HEDERA' })),
            ...stellarCash.map(u => ({ wallet: u.walletAddress, balance: parseFloat(u.balance || 0), chain: 'STELLAR' }))                                 
        ];

        masterCashPool.sort((a, b) => b.balance - a.balance);

        richlistMetrics.sgcshTopBalances = masterCashPool.slice(0, 300).map(u => ({
            wallet: u.wallet || 'Internal Account',
            balance: String(u.balance || "0.00"),
            chain: u.chain
        }));

    } catch (richlistErr) {
        console.warn(`⚠️ Global ranking distribution skipped: ${richlistErr.message}`);
    }

    // =============================================================
    // 5. FINAL ASSEMBLY: MATCH BY BOTH CHAIN AND TOKEN SYMBOL
    // =============================================================
    scoutReport.forEach(asset => {
        if (asset.chain) {
            asset.history = discoveredTransactions
                .filter(tx =>
                    tx.chain &&
                    tx.chain.toUpperCase() === asset.chain.toUpperCase() &&
                    tx.currency &&
                    tx.currency.toUpperCase() === asset.ticker.toUpperCase()
                )
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } else {
            asset.history = [];
        }
    });
    return {
        identityReport: scoutReport,
        globalMetrics: richlistMetrics
    };
}

module.exports = { executeMultiChainScout };

