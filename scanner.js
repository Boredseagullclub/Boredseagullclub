// 🦅 SEAGULL TREASURY GLOBAL METADATA PRE-SCANNER (scanner.js)
const fs = require('fs').promises;
const path = require('path');

// 🏛️ Master Collection Mappings
const COLLECTION_REGISTRY = [
  { name: 'GENESIS', issuer: 'rftc7W745AzRikYjWDn669nCE4CNNttzcz', taxon: 23173 },
  { name: '2ND_EDITION', issuer: 'rnCVggVUH7F76JBKNEEASZB8QahfYzc6fT', taxon: 148407461 },
  { name: '3RD_EDITION', issuer: 'rKoREYA3cFXPbAUtfj1Y2duMMymuWpuNDE', taxon: 3 },
  { name: 'MANSIONS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 24313 },
  { name: 'BUSINESS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 3 },
  { name: 'APARTMENTS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 24180 },
  { name: 'HERON', issuer: 'rKoREYA3cFXPbAUtfj1Y2duMMymuWpuNDE', taxon: 1 },
  { name: 'SEAGULLVERSE', issuer: 'rnCVggVUH7F76JBKNEEASZB8QahfYzc6fT', taxon: 2 }
];

// Helper to convert an ipfs:// path into an HTTP gateway URL (subdomain Strategy included)
const convertIpfsToGateway = (ipfsUri, fallbackType = 'cloudflare') => {
  if (!ipfsUri) return '';
  if (ipfsUri.startsWith('http')) return ipfsUri;

  const cleanPath = ipfsUri.replace(/^ipfs:\/\//, '');
  const firstSlashIndex = cleanPath.indexOf('/');
  const rootHash = firstSlashIndex === -1 ? cleanPath : cleanPath.slice(0, firstSlashIndex);
  const remainingRoute = firstSlashIndex === -1 ? '' : cleanPath.slice(firstSlashIndex);

  if (rootHash.startsWith('baf')) {
    if (fallbackType === 'pinata') return `https://${rootHash}.ipfs.nftstorage.link${remainingRoute}`;
    return `https://${rootHash}.ipfs.dweb.link${remainingRoute}`;
  }

  if (fallbackType === 'pinata') return `https://gateway.pinata.cloud/ipfs/${cleanPath}`;
  if (fallbackType === 'io') return `https://ipfs.io/ipfs/${cleanPath}`;
  return `https://cloudflare-ipfs.com/ipfs/${cleanPath}`;
};

// Delay helper to stay polite with public endpoints and avoid rate limits
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scanRegistry() {
  const globalCacheFile = path.join(process.cwd(), 'nft_metadata_cache.json');
  let assetRegistryCache = {};

  // Load existing cache progress if available
  try {
    const existingData = await fs.readFile(globalCacheFile, 'utf8');
    assetRegistryCache = JSON.parse(existingData);
    console.log(`Loaded existing cache containing ${Object.keys(assetRegistryCache).length} assets.`);
  } catch (err) {
    console.log('No pre-existing cache file located. Starting completely fresh...');
  }

  console.log('Starting Global Seagull Treasury ledger scan using native Node fetch...');

  for (const collection of COLLECTION_REGISTRY) {
    console.log(`\n🔍 Crawling Collection Group: ${collection.name}`);
    
    let marker = null;
    let hasMore = true;
    let totalCollected = 0;

    while (hasMore) {
      try {
        // Query XRPScan for all NFTs minted by this specific issuer account
        let url = `https://api.xrpscan.com/api/v1/account/${collection.issuer}/nfts?limit=100`;
        if (marker) url += `&marker=${marker}`;

        const res = await fetch(url);
        if (!res.ok) {
          console.error(`XRPScan error (${res.status}). Sleeping 5 seconds before retry...`);
          await sleep(5000);
          continue;
        }

        const payload = await res.json();
        const nfts = payload.nfts || [];
        marker = payload.marker || null;
        hasMore = !!marker;

        // Filter out items matching this precise taxon identifier
        const targetMints = nfts.filter(n => parseInt(n.taxon, 10) === collection.taxon);
        totalCollected += targetMints.length;

        for (const nft of targetMints) {
          const nftId = String(nft.nft_id || nft.id).trim();

          // Skip if this asset id is already fully cached down to its working image link
          if (assetRegistryCache[nftId] && assetRegistryCache[nftId].imageSrc) {
            continue;
          }

          console.log(`Processing Token ID: ${nftId.slice(0, 8)}... (Collection: ${collection.name})`);

          let rawUri = nft.uri || nft.URI || (nft.meta && nft.meta.uri) || '';
          if (!rawUri) {
            console.log(`↳ ⚠️ Empty token URI fields on target token ${nftId}`);
            continue;
          }

          // Step 1: Resolve the metadata manifest JSON payload
          let metaJson = null;
          const jsonStrategies = [
            convertIpfsToGateway(rawUri, 'cloudflare'),
            convertIpfsToGateway(rawUri, 'pinata'),
            convertIpfsToGateway(rawUri, 'io')
          ];

          for (const gatewayUrl of jsonStrategies) {
            try {
              // Signal integration for timeout handling using standard AbortController
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 4000);
              
              const metaRes = await fetch(gatewayUrl, { signal: controller.signal });
              clearTimeout(timeoutId);
              
              if (metaRes.ok) {
                metaJson = await metaRes.json();
                break;
              }
            } catch (e) {
              // Gracefully switch to the alternate strategy
            }
          }

          if (!metaJson) {
            console.log(`  ↳ ❌ Failed to fetch manifest JSON for token ${nftId}`);
            continue;
          }

          const rawImgPath = metaJson.image || metaJson.animation_url || '';
          if (!rawImgPath) {
            console.log(`  ↳ ⚠️ Manifest lacks media assets pointer on token ${nftId}`);
            continue;
          }

          // Step 2: Test image gateways to see which one delivers the media cleanly
          let verifiedImgSrc = '';
          const imageStrategies = [
            convertIpfsToGateway(rawImgPath, 'cloudflare'),
            convertIpfsToGateway(rawImgPath, 'pinata'),
            convertIpfsToGateway(rawImgPath, 'io')
          ];

          for (const testUrl of imageStrategies) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 4000);

              const imgTest = await fetch(testUrl, { method: 'HEAD', signal: controller.signal });
              clearTimeout(timeoutId);

              if (imgTest.ok) {
                verifiedImgSrc = testUrl;
                break;
              }
            } catch (e) {
              // Try next gateway option
            }
          }

          // If no gateway answers, fallback to the standard cloudflare string so we still save it
          if (!verifiedImgSrc) {
            verifiedImgSrc = convertIpfsToGateway(rawImgPath, 'cloudflare');
          }

          // Step 3: Write metadata payload into memory map
          assetRegistryCache[nftId] = {
            nftId: nftId,
            collectionName: collection.name,
            taxon: collection.taxon,
            name: metaJson.name || `Seagull Asset #${nft.sequence || '?'}_`,
            imageSrc: verifiedImgSrc,
            lastScanned: new Date().toISOString()
          };

          // Save tracking progress dynamically after every successful resolution
          await fs.writeFile(globalCacheFile, JSON.stringify(assetRegistryCache, null, 2), 'utf8');
          
          // Gentle breather to respect rate limits
          await sleep(150);
        }

        console.log(`Parsed Batch chunk. Collection total processed so far: ${totalCollected}`);
        await sleep(500);

      } catch (err) {
        console.error(`Unexpected loop breakdown error: ${err.message}`);
        await sleep(3000);
      }
    }
  }

  console.log('\n🎉 SCRIPT EXECUTION COMPLETE: Cache database completely compiled!');
}

scanRegistry();
