import React, { useState, useEffect } from 'react';
import * as xrpl from 'xrpl';

// 🦅 Master Collection Definition
const COLLECTION_REGISTRY = [
  { name: 'GENESIS', issuer: 'rftc7W745AzRikYjWDn669nCE4CNNttzcz', taxon: 23173, yieldAmount: 150, label: 'Genesis Tier' },
  { name: '2ND_EDITION', issuer: 'rnCVggVUH7F76JBKNEEASZB8QahfYzc6fT', taxon: 148407461, yieldAmount: 50, label: '2nd Edition' },
  { name: '3RD_EDITION', issuer: 'rKoREYA3cFXPbAUtfj1Y2duMMymuWpuNDE', taxon: 3, yieldAmount: 25, label: '3rd Edition' },
  { name: 'MANSIONS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 0, yieldAmount: 500, label: 'Seagullmansions' },
  { name: 'BUSINESS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 3, yieldAmount: 250, label: 'Commercial Business' },
  { name: 'APARTMENTS', issuer: 'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', taxon: 2, yieldAmount: 50, label: 'Luxury Apartment' },
  { name: 'HERON', issuer: 'rKoREYA3cFXPbAUtfj1Y2duMMymuWpuNDE', taxon: 1, yieldAmount: 1, label: 'Heron Asset' },
  { name: 'SEAGULLVERSE', issuer: 'rnCVggVUH7F76JBKNEEASZB8QahfYzc6fT', taxon: 2, yieldAmount: 10, label: 'Seagullverse Base' }
];

const STAKING_DESTINATION = 'rL9qvc9KhW7fX6eYtiw8a5HUEtYzGTYZcf';
const SEAGULL_COIN_HEX = '53656167756C6C436F696E000000000000000000';

const GATEWAY_BLACKLIST = {};
const banGateway = (gwName) => {
  GATEWAY_BLACKLIST[gwName] = Date.now() + 3 * 60 * 1000;
};
const isGatewayBanned = (gwName) => {
  if (!GATEWAY_BLACKLIST[gwName]) return false;
  if (Date.now() > GATEWAY_BLACKLIST[gwName]) {
    delete GATEWAY_BLACKLIST[gwName];
    return false;
  }
  return true;
};

// ⚡ MAXIMUM OVERKILL GATEWAY POOL
const getOrderedGatewayUrls = (ipfsUri) => {
  if (!ipfsUri) return [];
  let cleanUri = String(ipfsUri).trim().replace(/\0/g, '');
  if (cleanUri.startsWith('http')) return [{ name: 'direct', url: cleanUri }];
  let cleanPath = cleanUri.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '').replace(/^\/ipfs\//i, '');
  const firstSlashIndex = cleanPath.indexOf('/');
  let rootHash = firstSlashIndex === -1 ? cleanPath : cleanPath.slice(0, firstSlashIndex);
  const remainingRoute = firstSlashIndex === -1 ? '' : cleanPath.slice(firstSlashIndex);

  rootHash = rootHash.replace(/^ipfs:\/\//i, '').replace(/^ipfs/i, '');
  const pool = [
    { name: 'bithomp_cdn', url: `https://cdn.bithomp.com/image/${rootHash}${remainingRoute}` },
    { name: 'ipfs_io', url: `https://ipfs.io/ipfs/${rootHash}${remainingRoute}` },
    { name: 'gateway_ipfs', url: `https://gateway.ipfs.io/ipfs/${rootHash}${remainingRoute}` },
    { name: 'cloudflare', url: `https://cloudflare-ipfs.com/ipfs/${rootHash}${remainingRoute}` },
    { name: 'pinata_public', url: `https://gateway.pinata.cloud/ipfs/${rootHash}${remainingRoute}` },
    { name: 'nftstorage', url: remainingRoute ? `https://${rootHash}.ipfs.nftstorage.link${remainingRoute}` : `https://ipfs.io/ipfs/${rootHash}` },
    { name: 'w3s', url: remainingRoute ? `https://${rootHash}.ipfs.w3s.link${remainingRoute}` : `https://gateway.pinata.cloud/ipfs/${rootHash}` },
    { name: 'dweb', url: remainingRoute ? `https://${rootHash}.ipfs.dweb.link${remainingRoute}` : `https://ipfs.io/ipfs/${rootHash}` },
    { name: 'fleek', url: `https://ipfs.fleek.co/ipfs/${rootHash}${remainingRoute}` },
    { name: 'cors_proxy', url: `https://corsproxy.io/?https://ipfs.io/ipfs/${rootHash}${remainingRoute}` }
  ];

  const activePool = pool.filter(gw => !isGatewayBanned(gw.name));
  return activePool.length > 0 ? activePool : pool;
};

const decodeHexUri = (str) => {
  if (!str) return '';
  const cleanStr = String(str).trim();
  if (cleanStr.startsWith('ipfs://') || cleanStr.startsWith('http')) return cleanStr;
  if (/^[0-9a-fA-F]+$/.test(cleanStr) && cleanStr.length % 2 === 0) {
    try {
      let decoded = '';
      for (let i = 0; i < cleanStr.length; i += 2) {
        decoded += String.fromCharCode(parseInt(cleanStr.substr(i, 2), 16));
      }
      return decoded.replace(/\0/g, '').trim();
    } catch (e) { return cleanStr; }
  }
  return cleanStr;
};

const getSequenceFromNftId = (nftId) => {
  if (!nftId || nftId.length !== 64) return null;
  try { return parseInt(nftId.slice(-8), 16); } catch (e) { return null; }
};

const deeplyFindMediaUrl = (obj) => {
  if (!obj) return '';
  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if (trimmed.startsWith('ipfs://') || trimmed.startsWith('http://') || trimmed.startsWith('https://') || /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]{55})/i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }
  if (Array.isArray(obj)) {
    for (let item of obj) {
      const found = deeplyFindMediaUrl(item);
      if (found) return found;
    }
  } else if (typeof obj === 'object') {
    const primaryKeys = ['animation', 'image', 'video', 'animation_url', 'imageUrl', 'file', 'uri', 'url', 'image_url'];
    for (let k of primaryKeys) {
      if (obj[k] && typeof obj[k] === 'string') return obj[k].trim();
    }
    for (let k in obj) {
      const found = deeplyFindMediaUrl(obj[k]);
      if (found) return found;
    }
  }
  return '';
};

// 🖼 ===================== CARD COMPONENT =====================
const NFTCard = ({ nft, index, onClaim, onInitiateStake, onUnstake, showNotification }) => {
  const [isStaked, setIsStaked] = useState(nft.isStaked || false);
  const [imageWaterfalls, setImageWaterfalls] = useState([]);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [metadataName, setMetadataName] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const nftId = String(nft.id || nft.nft_id || nft.NFTokenID || '').trim();
  const sequenceNum = nft.sequenceNum !== undefined ? nft.sequenceNum : getSequenceFromNftId(nftId);

  useEffect(() => {
    let timer;
    if (isStaked) {
      const updateElapsed = () => {
        const stakingRecordTime = nft.stakedAt || Date.now();
        const diffInSeconds = Math.max(0, Math.floor((Date.now() - stakingRecordTime) / 1000));
        setSecondsElapsed(diffInSeconds);
      };

      updateElapsed();
      timer = setInterval(updateElapsed, 1000);
    } else {
      setSecondsElapsed(0);
    }
    return () => clearInterval(timer);
  }, [isStaked, nft.stakedAt]);

  const dailyYield = Number(nft.yieldAmount || 0);
  const earnedRewards = ((dailyYield / 86400) * secondsElapsed).toFixed(4);

  useEffect(() => {
    let isMounted = true;

    async function fetchMetadata() {
      try {
        setLoading(true);
        setErrorMsg('');
        setFallbackIndex(0);

        if (isMounted) {
          let defaultName = (sequenceNum !== null && nft.displayName !== 'MANSIONS') ? `${nft.label} #${sequenceNum}` : nft.label;
          setMetadataName(defaultName);
        }

        const cachedAsset = localStorage.getItem(`btc_nft_${nftId}`);
        if (cachedAsset) {
          const parsed = JSON.parse(cachedAsset);
          if (parsed.src) {
            if (isMounted) {
              setMetadataName(parsed.name);
              setImageWaterfalls([parsed.src]);
              setLoading(false);
              return;
            }
          }
        }

        let rawUrisToTry = [];
        const localUriCandidate = nft.uri || nft.URI || nft.URIHex || nft.url;
        if (localUriCandidate) {
          const decodedLocal = decodeHexUri(localUriCandidate);
          if (decodedLocal && !rawUrisToTry.includes(decodedLocal)) {
            rawUrisToTry.push(decodedLocal);
          }
        }

        await new Promise(resolve => setTimeout(resolve, index * 250));

        let networkUri = '';
        if (!networkUri) {
          try {
            const response = await fetch(`https://api.xrpscan.com/api/v1/nft/${nftId}`);
            if (response.ok) {
              const data = await response.json();
              networkUri = data.uri || data.URI || (data.meta && data.meta.uri) || data.URITokenURI || '';
            }
          } catch (e) {}
        }

        networkUri = decodeHexUri(networkUri);
        if (networkUri && !rawUrisToTry.includes(networkUri)) {
          rawUrisToTry.push(networkUri);
        }

        if (sequenceNum !== null && nft.displayName !== 'MANSIONS') {
          const sequencedCollections = ['GENESIS', '2ND_EDITION', '3RD_EDITION', 'HERON'];
          if (sequencedCollections.includes(nft.displayName)) {
            for (let baseUri of [...rawUrisToTry]) {
              const cleanedBase = baseUri.replace(/\/+$/, '');
              const variants = [
                `${cleanedBase}/${sequenceNum}.json`,
                `${cleanedBase}/${String(sequenceNum).padStart(3, '0')}.json`,
                `${cleanedBase}/${String(sequenceNum).padStart(4, '0')}.json`
              ];

              for (const sequencedJson of variants) {
                if (!rawUrisToTry.includes(sequencedJson)) {
                  rawUrisToTry.unshift(sequencedJson);
                }
              }
            }
          }
        }

        let metaJson = null;
        let finalMediaUrl = '';

        for (const currentTargetUri of rawUrisToTry) {
          if (!currentTargetUri || currentTargetUri.toLowerCase() === 'unspecified') continue;

          const manifestGateways = getOrderedGatewayUrls(currentTargetUri);
          for (const gw of manifestGateways) {
            try {
              const controller = new AbortController();
              const tId = setTimeout(() => controller.abort(), 4000);

              const metaRes = await fetch(gw.url, { signal: controller.signal });
              clearTimeout(tId);

              if (metaRes.ok) {
                const contentType = metaRes.headers.get('content-type') || '';
                if (contentType.includes('image/') || contentType.includes('video/')) {
                  finalMediaUrl = currentTargetUri;
                  break;
                }
                const textData = await metaRes.text();
                if (textData.trim().startsWith('<')) {
                  throw new Error("Gateway returned HTML instead of data");
                }

                try {
                  metaJson = JSON.parse(textData);
                  break;
                } catch (e) {
                  if (!currentTargetUri.toLowerCase().endsWith('.json')) {
                    finalMediaUrl = currentTargetUri;
                    break;
                  }
                }
              } else {
                banGateway(gw.name);
              }
            } catch (e) {
              banGateway(gw.name);
            }
          }
          if (metaJson) {
            finalMediaUrl = deeplyFindMediaUrl(metaJson);
            if (finalMediaUrl) break;
          } else if (finalMediaUrl) {
            break;
          }
        }

        if (!finalMediaUrl) {
          if (isMounted) {
            setErrorMsg('UNRESOLVED MEDIA');
            setLoading(false);
          }
          return;
        }

        if (isMounted) {
          const parsedName = (metaJson && metaJson.name) ? metaJson.name : (sequenceNum !== null && nft.displayName !== 'MANSIONS' ? `${nft.label} #${sequenceNum}` : nft.label);
          setMetadataName(parsedName);
          setImageWaterfalls(getOrderedGatewayUrls(finalMediaUrl));
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setErrorMsg(err.message || 'UNRESOLVED MEDIA');
          setLoading(false);
        }
      }
    }

    if (nftId) fetchMetadata();
    return () => { isMounted = false; };
  }, [nftId, nft.label, sequenceNum, nft.displayName, index, nft.uri, nft.URI, nft.URIHex, nft.url]);

  const handleImageError = () => {
    if (imageWaterfalls[fallbackIndex]) {
      const activeStrategy = imageWaterfalls[fallbackIndex];
      if (activeStrategy.name) banGateway(activeStrategy.name);
    }

    if (fallbackIndex < imageWaterfalls.length - 1) {
      setFallbackIndex(prev => prev + 1);
    } else {
      setErrorMsg('UNRESOLVED MEDIA');
    }
  };

  const handleImageLoadSuccess = () => {
    const currentUrl = imageWaterfalls[fallbackIndex]?.url || imageWaterfalls[fallbackIndex];
    if (currentUrl && metadataName) {
      const cachePayload = { name: metadataName, src: currentUrl };
      localStorage.setItem(`btc_nft_${nftId}`, JSON.stringify(cachePayload));
    }
  };

  const handleStakeAction = async () => {
    try {
      setActionLoading(true);
      setStatusMessage('SUBMITTING OFFER...');

      let timeLeft = 60;
      const countdownInterval = setInterval(() => {
        timeLeft -= 1;
        if (timeLeft > 0) {
          setStatusMessage(`PROCESSING (${timeLeft}s)...`);
        }
      }, 1000);

      const stakePromise = onInitiateStake({
        nftId,
        destination: STAKING_DESTINATION,
        nftObject: nft
      });

      const timerPromise = new Promise(resolve => setTimeout(resolve, 60000));
      await Promise.all([stakePromise, timerPromise]);

      clearInterval(countdownInterval);
      setIsStaked(true);
      setStatusMessage('');
      showNotification('SUCCESS', 'NFT successfully staked on-chain!');
    } catch (err) {
      console.error("Stake failed:", err);
      setStatusMessage('');
      showNotification('ERROR', `Stake failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnstakeAction = async () => {
    try {
      setActionLoading(true);
      setStatusMessage('WITHDRAWING...');

      if (onUnstake) {
        await onUnstake({ nftId, earnedRewards, currencyHex: SEAGULL_COIN_HEX });
      }

      setIsStaked(false);
      setSecondsElapsed(0);
      setStatusMessage('');
      showNotification('SUCCESS', 'NFT successfully unstaked and SeagullCash Rewards delivered!');
    } catch (err) {
      console.error("Unstake failed:", err);
      setStatusMessage('');
      showNotification('ERROR', `Unstake failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleClaimAction = async () => {
    try {
      setActionLoading(true);
      setStatusMessage('CLAIMING...');

      if (onClaim) {
        await onClaim({ nftId, earnedRewards, currencyHex: SEAGULL_COIN_HEX });
      }

      setSecondsElapsed(0);
      setStatusMessage('');
      showNotification('SUCCESS', `Successfully claimed ${earnedRewards} SGH!`);
    } catch (err) {
      console.error("Claim failed:", err);
      setStatusMessage('');
      showNotification('ERROR', `Claim failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const currentImgSrc = imageWaterfalls[fallbackIndex]?.url || imageWaterfalls[fallbackIndex];

  return (
    <div style={{
      background: '#0d0d0d',
      border: isStaked ? '2px solid #00ffcc' : '1px solid #1a1a1a',
      boxShadow: isStaked ? '0 0 15px rgba(0, 255, 204, 0.25)' : 'none',
      borderRadius: '16px', padding: '10px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box',
      position: 'relative'
    }}>
      {isStaked && (
        <div style={{
          position: 'absolute', top: '16px', right: '16px', zIndex: 10,
          background: 'rgba(0, 255, 204, 0.9)', color: '#000',
          padding: '3px 8px', borderRadius: '6px', fontSize: '8px', fontWeight: '900',
          fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
        }}>
          🔒 STAKED VAULT
        </div>
      )}

      <div style={{
        width: '100%', paddingTop: '100%', position: 'relative', borderRadius: '10px',
        overflow: 'hidden', background: '#050505', border: isStaked ? '1px solid #00ffcc' : '1px solid #111'
      }}>
        {loading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#666', fontFamily: 'monospace'
          }}>
            RESOLVING MEDIA...
          </div>
        )}
        {!loading && currentImgSrc && !errorMsg && (
          <img
            src={currentImgSrc}
            alt={metadataName || nft.label}
            loading="lazy"
            onError={handleImageError}
            onLoad={handleImageLoadSuccess}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        {!loading && errorMsg && (
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            padding: '10px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', background: '#111', border: '1px dashed #333'
          }}>
            <div style={{ fontSize: '24px', fontWeight: '900', color: '#444', marginBottom: '4px' }}>?</div>
            <div style={{ fontSize: '7px', color: '#666', fontFamily: 'monospace', textAlign: 'center' }}>ASSET UNAVAILABLE</div>
          </div>
        )}
      </div>

      <div style={{ marginTop: '8px' }}>
        <h4 style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '900', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {metadataName || (sequenceNum !== null && nft.displayName !== 'MANSIONS' ? `${nft.label} #${sequenceNum}` : nft.label) || 'Seagull Asset'}
        </h4>
        <p style={{ margin: '0 0 2px 0', fontSize: '8px', color: '#444', fontFamily: 'monospace' }}>Taxon: {nft.taxon}</p>
        <p style={{ margin: '0 0 4px 0', fontSize: '10px', color: '#00ffcc', fontWeight: 'bold' }}>⚡ {nft.yieldAmount} SGH/day</p>

        {!isStaked && (
          <div style={{
            background: '#141414', border: '1px solid #222', borderRadius: '4px', padding: '4px', margin: '4px 0',
            fontSize: '7px', color: '#ffa500', fontFamily: 'monospace', textAlign: 'center', lineHeight: '1.2'
          }}>
            ⚠️ 0.2 XRP reserve required to initiate offer but will be returned upon stake approval
          </div>
        )}

        {isStaked && (
          <div style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '6px', marginBottom: '8px' }}>
            <p style={{ margin: '0 0 2px 0', fontSize: '7px', color: '#888', fontFamily: 'monospace' }}>EARNED SEAGULL CASH:</p>
            <p style={{ margin: 0, fontSize: '11px', color: '#00d4ff', fontWeight: '900', fontFamily: 'monospace' }}>{earnedRewards} SGH</p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {!isStaked ? (
            <button
              onClick={handleStakeAction}
              disabled={actionLoading}
              style={{
                width: '100%', padding: '6px 0', background: '#00d4ff', color: '#000', border: 'none',
                borderRadius: '8px', fontSize: '9px', fontWeight: '900', cursor: actionLoading ? 'wait' : 'pointer',
                opacity: actionLoading ? 0.7 : 1
              }}
            >
              {actionLoading ? (statusMessage || 'PROCESSING...') : 'INITIATE_STAKE'}
            </button>
          ) : (
            <>
              <button
                onClick={handleClaimAction}
                disabled={actionLoading}
                style={{
                  width: '100%', padding: '6px 0', background: '#fff', color: '#000', border: 'none',
                  borderRadius: '8px', fontSize: '9px', fontWeight: '900', cursor: actionLoading ? 'wait' : 'pointer',
                  opacity: actionLoading ? 0.7 : 1
                }}
              >
                {actionLoading ? (statusMessage || 'PROCESSING...') : 'CLAIM CREDITS'}
              </button>
              <button
                onClick={handleUnstakeAction}
                disabled={actionLoading}
                style={{
                  width: '100%', padding: '6px 0', background: '#ff3366', color: '#fff', border: 'none',
                  borderRadius: '8px', fontSize: '9px', fontWeight: '900', cursor: actionLoading ? 'wait' : 'pointer',
                  opacity: actionLoading ? 0.7 : 1
                }}
              >
                {actionLoading ? (statusMessage || 'PROCESSING...') : 'UNSTAKE & WITHDRAW'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// 🏛 ===================== GALLERY RECONCILER =====================
const NFTGallery = ({ holdings = [], stakedHoldings = [], onClaim, onInitiateStake, onUnstake, showNotification }) => {
  const [activeTab, setActiveTab] = useState('ALL');

  const mapNft = (nft, forcedStakedState) => {
    if (!nft) return null;
    const nftIssuerLower = String(nft.issuer || nft.Issuer || '').trim().toLowerCase();
    let rawTaxon = nft.taxon ?? nft.NFTokenTaxon;
    const nftTaxonNormalized = rawTaxon !== undefined && rawTaxon !== null ? parseInt(rawTaxon, 10) : null;

    const match = COLLECTION_REGISTRY.find(c => {
      const issuerMatch = c.issuer.toLowerCase() === nftIssuerLower;
      if (!issuerMatch) return false;
      const targetTaxon = parseInt(c.taxon, 10);
      if (targetTaxon === 0) {
        return nftTaxonNormalized === 0 || nftTaxonNormalized === null || isNaN(nftTaxonNormalized);
      }
      return nftTaxonNormalized === targetTaxon;
    });

    if (!match) return null;
    const resolvedId = nft.id || nft.nft_id || nft.NFTokenID;
    const derivedSeq = getSequenceFromNftId(resolvedId);

    return {
      ...nft,
      id: resolvedId,
      issuer: nftIssuerLower,
      taxon: nftTaxonNormalized === null ? parseInt(match.taxon, 10) : nftTaxonNormalized,
      displayName: match.name,
      yieldAmount: match.yieldAmount,
      label: match.label,
      sequenceNum: derivedSeq,
      isStaked: forcedStakedState,
      stakedAt: nft.stakedAt || Date.now()
    };
  };

  const validMappedHoldings = holdings.map(n => mapNft(n, false)).filter(Boolean);
  const validMappedStaked = stakedHoldings.map(n => mapNft(n, true)).filter(Boolean);

  const uniqueCollectionsInWallet = Array.from(new Set([...validMappedHoldings, ...validMappedStaked].map(n => n.displayName)));
  const tabNames = ['ALL', '🔒 CURRENT STAKES', ...uniqueCollectionsInWallet];
  const displayedHoldings = activeTab === '🔒 CURRENT STAKES'
    ? validMappedStaked
    : activeTab === 'ALL'
    ? validMappedHoldings
    : validMappedHoldings.filter(n => n.displayName === activeTab);

  return (
    <div style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'sans-serif' }}>
      <div style={{
        display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '20px',
        scrollbarWidth: 'none'
      }}>
        {tabNames.map((name) => {
          const count = name === 'ALL'
            ? validMappedHoldings.length
            : name === '🔒 CURRENT STAKES'
            ? validMappedStaked.length
            : validMappedHoldings.filter(n => n.displayName === name).length;

          const isStakesTab = name === '🔒 CURRENT STAKES';
          const isActive = activeTab === name;

          return (
            <button
              key={name}
              onClick={() => setActiveTab(name)}
              style={{
                padding: '6px 12px',
                background: isActive ? (isStakesTab ? '#00ffcc' : '#00d4ff') : '#111',
                color: isActive ? '#000' : '#666',
                border: isActive ? `1px solid ${isStakesTab ? '#00ffcc' : '#00d4ff'}` : '1px solid #222',
                borderRadius: '20px',
                fontSize: '10px',
                fontWeight: '900',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {name} ({count})
            </button>
          );
        })}
      </div>
      {displayedHoldings.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', borderTop: '1px solid #111' }}>
          <p style={{ fontSize: '13px', color: '#444', margin: 0 }}>
            {activeTab === '🔒 CURRENT STAKES' ? 'No active staked assets found in your vault.' : 'No recognized treasury assets found.'}
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', width: '100%'
        }}>
          {displayedHoldings.map((nft, idx) => (
            <NFTCard key={nft.id || idx} index={idx} nft={nft} onClaim={onClaim} onInitiateStake={onInitiateStake} onUnstake={onUnstake} showNotification={showNotification} />
          ))}
        </div>
      )}
    </div>
  );
};

// 🖼 ===================== WRAPPER ROUTE COMPONENT ===================== 

const NFTUtility = ({ userAddress }) => {
  const getStorageAddress = () => {
    if (userAddress && userAddress !== 'GUEST_MODE') return userAddress;
    const mnemonic = localStorage.getItem('secret');
    if (mnemonic) {
      try {
        const wallet = xrpl.Wallet.fromMnemonic(mnemonic);
        if (wallet && wallet.address) return wallet.address;
      } catch (e) {}
    }
    return localStorage.getItem('cached_xrpl_address') || localStorage.getItem('sovereign_local') || 'GUEST_MODE';
  };

  const resolvedAddress = getStorageAddress();
  const [holdings, setHoldings] = useState([]);
  
  // 🔒 Initialize with localStorage first
  const [stakedHoldings, setStakedHoldings] = useState(() => {
    const targetAddr = getStorageAddress();
    if (!targetAddr || targetAddr === 'GUEST_MODE') return [];
    try {
      const saved = localStorage.getItem(`btc_staked_tokens_${targetAddr}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Sync stakes synchronously to local state and storage, and async to MongoDB backup in background
    const savePersistentStakes = (updatedStakes) => {
    setStakedHoldings(updatedStakes);
    const activeAddr = getStorageAddress();
    
    if (activeAddr && activeAddr !== 'GUEST_MODE') {
      // 1. Local cache backup (instant)
      localStorage.setItem(`btc_staked_tokens_${activeAddr}`, JSON.stringify(updatedStakes));

      // 2. MongoDB cloud backup
      fetch('/api/vault/sync-stakes', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Wallet-Address': activeAddr // 👈 Added missing auth header
        },
        body: JSON.stringify({ userAddress: activeAddr, stakedHoldings: updatedStakes })
      }).then(res => {
        if (!res.ok) console.error("Database sync rejected. Status:", res.status);
      }).catch(err => {
        console.error("Failed to sync stakes to MongoDB backup:", err);
      });
    }
  };


  // Fetch from MongoDB backup on mount/address change if local storage is empty
  useEffect(() => {
    let isMounted = true;
    async function syncCloudStakes() {
      const activeAddr = getStorageAddress();
      if (!activeAddr || activeAddr === 'GUEST_MODE') return;

      try {
        const res = await fetch(`/api/vault/stakes/${activeAddr}`);
        const data = await res.json();
        if (isMounted && data.success && data.stakedHoldings && data.stakedHoldings.length > 0) {
          const localSaved = JSON.parse(localStorage.getItem(`btc_staked_tokens_${activeAddr}`) || '[]');
          if (localSaved.length === 0) {
            setStakedHoldings(data.stakedHoldings);
            localStorage.setItem(`btc_staked_tokens_${activeAddr}`, JSON.stringify(data.stakedHoldings));
          }
        }
      } catch (err) {
        console.error("Failed to fetch cloud stakes backup:", err);
      }
    }

    syncCloudStakes();
    return () => { isMounted = false; };
  }, [resolvedAddress]);

  const handleInitiateStake = async ({ nftId, destination, nftObject }) => {
    const mnemonic = localStorage.getItem('secret');
    if (!mnemonic) throw new Error("No wallet seed found");

    const wallet = xrpl.Wallet.fromMnemonic(mnemonic);
    const client = new xrpl.Client('wss://xrplcluster.com');
    await client.connect();

    try {
      const tx = {
        TransactionType: "NFTokenCreateOffer",
        Account: wallet.address,
        NFTokenID: nftId,
        Destination: destination,
        Amount: "0",
        Flags: 1
      };
      const prepared = await client.autofill(tx);
      const signed = wallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);
      console.log("NFT Staked On-Chain:", result);

      const targetNft = holdings.find(n => (n.id || n.nft_id || n.NFTokenID) === nftId) || nftObject;
      if (targetNft) {
        const nextHoldings = holdings.filter(n => (n.id || n.nft_id || n.NFTokenID) !== nftId);
        const stakedPayload = { ...targetNft, stakedAt: Date.now() };
        const nextStaked = [...stakedHoldings, stakedPayload];
        setHoldings(nextHoldings);
        savePersistentStakes(nextStaked);
      }

      return result;
    } finally {
      await client.disconnect();
    }
  };

  const handleUnstake = async ({ nftId, earnedRewards, currencyHex }) => {
    try {
      const activeAddr = getStorageAddress();
      const response = await fetch('/api/unstake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-Address': activeAddr || 'GUEST_MODE'
        },
        body: JSON.stringify({
          nftId: nftId,
          userAddress: activeAddr,
          earnedRewards: earnedRewards
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Server failed to process unstake offer.');
      }

      console.log("NFT Unstaked and Vault Return Offer Created via Backend:", data.result);

      const releasedNft = stakedHoldings.find(n => (n.id || n.nft_id || n.NFTokenID) === nftId);
      const nextStaked = stakedHoldings.filter(n => (n.id || n.nft_id || n.NFTokenID) !== nftId);
      const nextHoldings = releasedNft ? [...holdings, releasedNft] : holdings;

      setHoldings(nextHoldings);
      savePersistentStakes(nextStaked);

      return data.result;
    } catch (err) {
      console.error("Unstake request failed:", err);
      throw err;
    }
  };

  const handleClaim = async ({ nftId, earnedRewards, currencyHex }) => {
    try {
      const activeAddr = getStorageAddress();
      const response = await fetch('/api/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-Address': activeAddr || 'GUEST_MODE'
        },
        body: JSON.stringify({
          userAddress: activeAddr,
          earnedRewards: earnedRewards,
          currencyHex: currencyHex
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Server failed to process claim payout.');
      }

      console.log("Claim payout successful:", data.txHash);

      const nextStaked = stakedHoldings.map(n => {
        if ((n.id || n.nft_id || n.NFTokenID) === nftId) {
          return { ...n, stakedAt: Date.now() };
        }
        return n;
      });
      savePersistentStakes(nextStaked);

      return data;
    } catch (err) {
      console.error("Claim request failed:", err);
      throw err;
    }
  };

  useEffect(() => {
    let isMounted = true;
    async function fetchHoldings() {
      const activeAddr = getStorageAddress();
      if (!activeAddr || activeAddr === 'GUEST_MODE') {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const res = await fetch('https://xrplcluster.com/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'account_nfts',
            params: [{ account: activeAddr }]
          })
        });
        const data = await res.json();

        if (isMounted) {
          const rawNfts = data?.result?.account_nfts || data?.account_nfts || [];
          
          const currentSavedStakes = JSON.parse(localStorage.getItem(`btc_staked_tokens_${activeAddr}`) || '[]');
          const stakedIds = new Set(currentSavedStakes.map(s => s.id || s.nft_id || s.NFTokenID));
          const filteredHoldings = rawNfts.filter(n => !stakedIds.has(n.id || n.nft_id || n.NFTokenID));

          setHoldings(filteredHoldings);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to fetch account NFTs:", err);
        if (isMounted) setLoading(false);
      }
    }

    fetchHoldings();
    return () => { isMounted = false; };
  }, [resolvedAddress]);

  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null);

  const showNotification = (type, message) => {
    setNotification({ type, message });
  };

  const closeNotification = () => {
    setNotification(null);
  };

  if (loading && stakedHoldings.length === 0) {
    return (
      <div style={{ color: '#00d4ff', fontFamily: 'monospace', padding: '40px', textAlign: 'center' }}>
        SCANNING SOVEREIGN LEDGER FOR TREASURY ASSETS...
      </div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: '1200px', boxSizing: 'border-box', position: 'relative' }}>
      <div style={{ marginBottom: '20px', borderBottom: '1px solid #1a1a1a', paddingBottom: '15px' }}>
        <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: '900', fontStyle: 'italic', margin: '0 0 5px 0' }}>
          TREASURY VAULT & STAKING
        </h2>
        <p style={{ color: '#666', fontSize: '10px', fontFamily: 'monospace', margin: 0 }}>
          ACTIVE ACCOUNT: {resolvedAddress}
        </p>
      </div>

      <NFTGallery
        holdings={holdings}
        stakedHoldings={stakedHoldings}
        onInitiateStake={handleInitiateStake}
        onUnstake={handleUnstake}
        onClaim={handleClaim}
        showNotification={showNotification}
      />

      {notification && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0, 0, 0, 0.8)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#111',
            border: notification.type === 'SUCCESS' ? '1px solid #00ffcc' : '1px solid #ff3366',
            borderRadius: '16px', padding: '24px', width: '90%', maxWidth: '380px',
            boxShadow: notification.type === 'SUCCESS' ? '0 0 25px rgba(0, 255, 204, 0.2)' : '0 0 25px rgba(255, 51, 102, 0.2)',
            textAlign: 'center', fontFamily: 'sans-serif', boxSizing: 'border-box'
          }}>
            <div style={{ fontSize: '28px', marginBottom: '10px' }}>
              {notification.type === 'SUCCESS' ? '⚡' : '⚠️'}
            </div>
            <h3 style={{
              margin: '0 0 8px 0', fontSize: '14px', fontWeight: '900', letterSpacing: '1px',
              color: notification.type === 'SUCCESS' ? '#00ffcc' : '#ff3366', fontFamily: 'monospace'
            }}>
              {notification.type === 'SUCCESS' ? 'TRANSACTION SUCCESSFUL' : 'ACTION FAILED'}
            </h3>
            <p style={{
              margin: '0 0 20px 0', fontSize: '11px', color: '#aaa', lineHeight: '1.4', fontFamily: 'monospace'
            }}>
              {notification.message}
            </p>
            <button
              onClick={closeNotification}
              style={{
                width: '100%', padding: '10px 0',
                background: notification.type === 'SUCCESS' ? '#00ffcc' : '#ff3366',
                color: '#000', border: 'none', borderRadius: '8px',
                fontSize: '10px', fontWeight: '900', cursor: 'pointer', fontFamily: 'monospace'
              }}
            >
              DISMISS
            </button>
          </div>
        </div>
      )}
    </div>
  );
};




export default NFTUtility;
