require('dotenv').config({ path: '/root/Boredseagullclub/.env' });
const mongoose = require('mongoose');
const https = require('https');

const REGISTRY = {
  SGC_ISSUER: 'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno',
  SGC_HEX: '53656167756C6C436F696E000000000000000000'
};

const XRPL_EPOCH_OFFSET = 946684800;
const BULK_BATCH_SIZE = 200; // Dropped batch size to guarantee stable intermediary writes
const PRODUCTION_NODE = 'xrplcluster.com';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function postToNodeWithRetry(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: PRODUCTION_NODE,
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      },
      timeout: 25000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP_STATUS_${res.statusCode}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("RAW_PARSE_FAILURE")); }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error("NODE_TIMEOUT"));
    });

    req.write(payload);
    req.end();
  });
}

async function fetchWithBackoff(body) {
  let attempts = 0;
  let delay = 2000;
  while (attempts < 10) {
    try {
      const response = await postToNodeWithRetry(body);
      if (response.error || (response.result && response.result.error)) {
        attempts++;
        await sleep(delay);
        delay *= 1.5;
        continue;
      }
      return response;
    } catch (err) {
      attempts++;
      await sleep(delay);
      delay *= 1.5;
    }
  }
  throw new Error("Cluster endpoint is completely unresponsive or rate-limiting aggressively.");
}

function parseTxPrice(txData, issuer, currencyHex) {
  const meta = txData.meta || txData.metadata;
  if (!meta || meta.TransactionResult !== "tesSUCCESS") return null;

  const nodes = meta.AffectedNodes || [];
  let xrpAmount = 0;
  let tokenAmount = 0;

  for (const node of nodes) {
    const edge = node.ModifiedNode || node.CreatedNode || node.DeletedNode;
    if (!edge) continue;

    const ff = edge.FinalFields || edge.NewFields;
    const pf = edge.PreviousFields;
    if (!ff) continue;

    const nodeString = JSON.stringify(edge);
    if (nodeString.includes(issuer) && nodeString.includes(currencyHex)) {
      let currentVal = 0;
      let prevVal = 0;

      if (ff.Balance && typeof ff.Balance === 'object' && ff.Balance.currency === currencyHex) {
        currentVal = Math.abs(parseFloat(ff.Balance.value));
        prevVal = pf && pf.Balance && pf.Balance.value ? Math.abs(parseFloat(pf.Balance.value)) : 0;
      } else if (ff.Amount2 && typeof ff.Amount2 === 'object' && ff.Amount2.currency === currencyHex) {
        currentVal = Math.abs(parseFloat(ff.Amount2.value));
        prevVal = pf && pf.Amount2 && pf.Amount2.value ? Math.abs(parseFloat(pf.Amount2.value)) : 0;
      }

      const diff = Math.abs(currentVal - prevVal);
      if (diff > 0) tokenAmount += diff;
    }
  }

  for (const node of nodes) {
    const edge = node.ModifiedNode || node.CreatedNode || node.DeletedNode;
    if (!edge || edge.LedgerEntryType !== 'AccountRoot') continue;

    const ff = edge.FinalFields;
    const pf = edge.PreviousFields;
    if (ff && pf && pf.Balance && ff.Balance) {
      const diff = Math.abs(parseFloat(ff.Balance) - parseFloat(pf.Balance));
      if (diff > 0) xrpAmount += diff;
    }
  }

  if (xrpAmount > 0 && tokenAmount > 0) {
    return (xrpAmount / 1000000) / tokenAmount;
  }
  return null;
}

async function streamAmmHistory() {
  console.log("📡 RESOLVING AMM ACCOUNT ADDRESS USING SEAGULLCOIN HEX...");

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const historyCollection = db.collection('price_history');

    const ammInfoResponse = await fetchWithBackoff({
      method: "amm_info",
      params: [{
        asset: { currency: "XRP" },
        asset2: { currency: REGISTRY.SGC_HEX, issuer: REGISTRY.SGC_ISSUER }
      }]
    });

    if (ammInfoResponse.error || !ammInfoResponse.result || !ammInfoResponse.result.amm) {
      throw new Error("Could not discover AMM context structure.");
    }

    const ammAccount = ammInfoResponse.result.amm.account;
    console.log(`\n🎯 Successfully Isolated AMM Pool Account: ${ammAccount}`);
    console.log("🚀 Extracting full timeline records...");

    let marker = undefined;
    let pageCount = 1;
    let bulkOps = [];
    let totalProcessed = 0;

    do {
      console.log(`   Scraping AMM Ledger Logs - Page ${pageCount}...`);
      
      const rpcResponse = await fetchWithBackoff({
        method: "account_tx",
        params: [{
          account: ammAccount,
          ledger_index_min: -1,
          ledger_index_max: -1,
          forward: true,
          limit: 200, // Dropped limit from 400 to ease network payload stress
          marker: marker
        }]
      });

      const result = rpcResponse.result;
      if (!result || !result.transactions || result.transactions.length === 0) {
        break;
      }

      for (const record of result.transactions) {
        const tx = record.tx || record;
        if (!tx.close_time) continue;

        const price = parseTxPrice(record, REGISTRY.SGC_ISSUER, REGISTRY.SGC_HEX);
        if (price && price > 0) {
          const exactTimestamp = new Date((tx.close_time + XRPL_EPOCH_OFFSET) * 1000);

          bulkOps.push({
            updateOne: {
              filter: { timestamp: exactTimestamp },
              update: { $set: { SGC_XRP: price } },
              upsert: true
            }
          });

          if (bulkOps.length >= BULK_BATCH_SIZE) {
            const batchResult = await historyCollection.bulkWrite(bulkOps, { ordered: false });
            totalProcessed += batchResult.upsertedCount + batchResult.modifiedCount;
            console.log(`      💾 Interim Recovery Batch Saved. Total integrated: ${totalProcessed}`);
            bulkOps = []; 
          }
        }
      }

      marker = result.marker;
      pageCount++;
      if (marker) await sleep(1500); // Enforced safety throttle to stop node disconnects
    } while (marker);

    if (bulkOps.length > 0) {
      const finalBatch = await historyCollection.bulkWrite(bulkOps, { ordered: false });
      totalProcessed += finalBatch.upsertedCount + finalBatch.modifiedCount;
    }

    console.log(`\n🏁 SUCCESS: Target data completely integrated into SeagullNet. Total Verified Records: ${totalProcessed}`);

  } catch (err) {
    console.error("\n❌ OPERATION FAILED:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

streamAmmHistory();
