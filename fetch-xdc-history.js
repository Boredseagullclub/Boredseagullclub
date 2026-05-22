require('dotenv').config({ path: '/root/Boredseagullclub/.env' });
const mongoose = require('mongoose');
const axios = require('axios');

const REGISTRY = {
  XDC_POOL:   '0x1c55eba3bb492d2e3af4eb3a9308b8046d7e4ccb',
  XDC_TOKEN:  '0xd38109F587bd0326CAd60a18CF3C1ECD546809a6'
};

const SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';

function decodeSyncReserves(data) {
  if (!data || data === '0x' || data.length < 130) return null;
  const cleanData = data.replace('0x', '');
  try {
    return {
      reserve0: BigInt('0x' + cleanData.slice(0, 64)),
      reserve1: BigInt('0x' + cleanData.slice(64, 128))
    };
  } catch (e) {
    return null;
  }
}

async function fetchPaginatedXdcHistory() {
  console.log("🦅 XDC API DEEP RECONCILIATION: Initializing Multi-Year Pagination Loop...");

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    console.log("🛰️ Secure database pipeline synchronized.");

    const historyTimeline = {};
    let currentToBlock = 'latest';
    let keepFetching = true;
    let totalLogsCollected = 0;
    let loopIteration = 1;

    while (keepFetching && loopIteration <= 30) {
      const apiUrl = `https://api.xdcscan.io/api?module=logs&action=getLogs&address=${REGISTRY.XDC_POOL}&topic0=${SYNC_TOPIC}&fromBlock=0&toBlock=${currentToBlock}`;
      console.log(`📡 [Page ${loopIteration}] Fetching logs from block 0 to ${currentToBlock}...`);

      const response = await axios.get(apiUrl);

      if (!response.data || !Array.isArray(response.data.result) || response.data.result.length === 0) {
        console.log("🏁 Reached the end of available historical logs.");
        keepFetching = false;
        break;
      }

      const logs = response.data.result;
      totalLogsCollected += logs.length;
      console.log(`   ⚡ Received ${logs.length} logs (Total collected: ${totalLogsCollected}).`);

      let lowestBlockInChunk = Number.MAX_SAFE_INTEGER;

      for (const log of logs) {
        const blockNum = parseInt(log.blockNumber, 16) || parseInt(log.blockNumber, 10);
        if (blockNum < lowestBlockInChunk) lowestBlockInChunk = blockNum;

        const timestampSeconds = parseInt(log.timeStamp, 16);
        const timestamp = new Date(timestampSeconds * 1000);
        const dayKey = timestamp.toISOString().split('T')[0];

        const reserves = decodeSyncReserves(log.data);
        if (!reserves) continue;

        const r0 = parseFloat(reserves.reserve0);
        const r1 = parseFloat(reserves.reserve1);

        if (r0 > 0 && r1 > 0) {
          // FIXED MATH: True price scale ratio
          const price = r0 / r1;

          if (!historyTimeline[dayKey]) {
            historyTimeline[dayKey] = { timestamp, price: parseFloat(price.toFixed(8)) };
          }
        }
      }

      if (logs.length < 1000) {
        keepFetching = false;
      } else {
        currentToBlock = lowestBlockInChunk - 1;
        loopIteration++;
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const updates = Object.keys(historyTimeline);
    console.log(`\n📦 Staging real on-chain entries for ${updates.length} unique days. Modifying database...`);

    for (const dayKey of updates) {
      const record = historyTimeline[dayKey];
      await db.collection('price_history').updateOne(
        {
          timestamp: {
            $gte: new Date(dayKey + "T00:00:00.000Z"),
            $lte: new Date(dayKey + "T23:59:59.999Z")
          }
        },
        { 
          $set: { 
            timestamp: record.timestamp,
            SGC_XDC: record.price 
          } 
        },
        { upsert: true }
      );
    }

    console.log("🏁 SUCCESS: Deep historical back-population completed.");

  } catch (err) {
    console.error("❌ CRITICAL PROCESS FAILURE:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Connections severed cleanly.");
    process.exit(0);
  }
}

fetchPaginatedXdcHistory();
