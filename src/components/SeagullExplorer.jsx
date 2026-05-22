import React, { useState } from 'react';
import axios from 'axios';

const SeagullExplorer = () => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const ASSET_LOGOS = {
    'XRPL': 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
    'XLM': 'https://cryptologos.cc/logos/stellar-xlm-logo.png',
    'HBAR': 'https://cryptologos.cc/logos/hedera-hbar-logo.png',
    'FLARE': 'https://cryptologos.cc/logos/flare-flr-logo.png',
    'XDC': 'https://cryptologos.cc/logos/xdc-network-xdc-logo.png',
    'SGC': 'https://files.catbox.moe/utrpfc.png',
    'SGCN': 'https://files.catbox.moe/utrpfc.png',
    'SeagullCoin': 'https://files.catbox.moe/utrpfc.png',
    'SGCSH': 'https://files.catbox.moe/w3cets.png',
    'SeagullCash': 'https://files.catbox.moe/w3cets.png'
  };

  const handleSearch = async () => {
    if (!search) return;
    setLoading(true);
    setResults(null);
    try {
      const res = await axios.get(`/api/explorer/scout/${search.trim()}`);
      if (res.data && res.data.success) {
        setResults(res.data.data);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error("Scout mission failed:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={glowBackgroundStyle}></div>

      <div style={{ textAlign: 'center', marginBottom: '40px', position: 'relative' }}>
        <div style={logoBadgeStyle}>🦅</div>
        <h1 style={titleStyle}>
          SEAGULL <span style={{ color: '#00d4ff' }}>EXPLORER</span>
        </h1>
        <p style={subtitleStyle}>UNIVERSAL STATE PORTAL • ISO 20022</p>
      </div>

      <div style={searchContainerStyle}>
        <div style={inputPrefixStyle}>SYSTEM://</div>
        <input
          type="text"
          placeholder="Interrogate Address (r... / G... / 0x...)"
          style={inputFieldStyle}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch} style={scoutButtonStyle}>
          {loading ? 'SCANNING...' : 'SCOUT'}
        </button>
      </div>

      <div style={{ width: '100%', maxWidth: '650px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {loading && <p style={loadingStatusStyle}>Pinging Distributed Ledger Nodes...</p>}

        {!loading && results && results.length > 0 && (
          <>
            <div style={tableHeaderStyle}>
              <span style={{ color: '#555' }}>SOVEREIGN ASSETS EXTRACTED</span>
              <span style={liveBadgeStyle}>LIVE MAINNET SYNC</span>
            </div>

            {results.map((asset, i) => {
              const rawBalance = typeof asset.balance === 'number' ? asset.balance : parseFloat(asset.balance || 0);
              const formattedBalance = isNaN(rawBalance) ? "0.00" : rawBalance.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6
              });

              const cleanIssuer = asset.issuer && asset.issuer !== 'Native'
                ? `${asset.issuer.slice(0, 8)}...${asset.issuer.slice(-8)}`
                : 'Core Protocol Asset';

              const fallbackLogo = "https://cryptologos.cc/logos/xrp-xrp-logo.png";

              return (
                <div key={i} style={resultCardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={logoWrapperStyle}>
                      <img 
                        src={ASSET_LOGOS[asset.symbol] || ASSET_LOGOS[asset.chain] || fallbackLogo} 
                        alt={asset.chain}
                        style={logoImageStyle}
                        onError={(e) => { e.target.src = fallbackLogo; }}
                      />
                    </div>
                    <div>
                      <h4 style={assetNameStyle}>{asset.name}</h4>
                      <div style={metaDataStyle}>
                        <span style={chainBadgeStyle}>{asset.chain}</span>
                        <span style={{ color: '#333' }}>•</span>
                        <span style={{ color: '#666' }}>{cleanIssuer}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={balanceValueStyle}>{formattedBalance}</div>
                    <div style={balanceLabelStyle}>{asset.symbol || 'UNIT'} ALLOCATION</div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {!loading && results && results.length === 0 && (
          <div style={emptyStateCardStyle}>
            <p style={{ margin: 0, color: '#666', fontSize: '12px', fontWeight: 'bold' }}>NO ACTIVE TRUSTLINES OR BALANCES RECORDED.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const containerStyle = { minHeight: '100vh', backgroundColor: '#050505', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 20px', position: 'relative', overflow: 'hidden', fontFamily: 'sans-serif', color: '#fff', boxSizing: 'border-box' };
const glowBackgroundStyle = { position: 'absolute', top: '0', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '300px', backgroundColor: 'rgba(0, 212, 255, 0.03)', filter: 'blur(100px)', borderRadius: '50%', pointerEvents: 'none' };
const logoBadgeStyle = { width: '60px', height: '60px', borderRadius: '16px', border: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', backgroundColor: '#0a0a0a', marginBottom: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' };
const titleStyle = { margin: 0, fontSize: '38px', fontWeight: '900', fontStyle: 'italic', letterSpacing: '-1px', textTransform: 'uppercase' };
const subtitleStyle = { margin: '8px 0 0 0', fontSize: '9px', color: '#444', letterSpacing: '4px', fontWeight: 'bold' };

const searchContainerStyle = { width: '100%', maxWidth: '650px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '24px', display: 'flex', alignItems: 'center', overflow: 'hidden', marginBottom: '40px', boxShadow: '0 20px 50px rgba(0,0,0,0.7)', boxSizing: 'border-box' };
const inputPrefixStyle = { paddingLeft: '20px', color: 'rgba(0, 212, 255, 0.3)', fontFamily: 'monospace', fontSize: '12px', fontWeight: 'bold', flexShrink: 0 };
const inputFieldStyle = { width: '100%', backgroundColor: 'transparent', border: 'none', padding: '22px 15px', outline: 'none', color: '#fff', fontFamily: 'monospace', fontSize: '14px', boxSizing: 'border-box' };
const scoutButtonStyle = { padding: '0 35px', height: '65px', backgroundColor: '#00d4ff', color: '#000', fontWeight: '900', fontStyle: 'italic', border: 'none', cursor: 'pointer', fontSize: '13px', borderLeft: '1px solid #1a1a1a', flexShrink: 0 };

const loadingStatusStyle = { textAlign: 'center', color: '#00d4ff', fontSize: '11px', fontFamily: 'monospace', letterSpacing: '2px', textTransform: 'uppercase', margin: '40px 0' };
const tableHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 5px', fontSize: '9px', fontWeight: 'bold', letterSpacing: '1px', width: '100%', marginBottom: '10px' };
const liveBadgeStyle = { color: '#00ffcc', backgroundColor: 'rgba(0,255,204,0.05)', border: '1px solid rgba(0,255,204,0.15)', padding: '3px 8px', borderRadius: '6px' };

const resultCardStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '24px', padding: '20px 25px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', width: '100%', boxSizing: 'border-box' };
const logoWrapperStyle = { width: '42px', height: '42px', backgroundColor: '#000', border: '1px solid #1e1e1e', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', boxSizing: 'border-box', flexShrink: 0 };
const logoImageStyle = { width: '100%', height: '100%', objectFit: 'contain' };
const assetNameStyle = { margin: 0, fontSize: '18px', fontWeight: '900', fontStyle: 'italic', textTransform: 'uppercase' };
const metaDataStyle = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', fontFamily: 'monospace', fontSize: '10px' };
const chainBadgeStyle = { color: '#00d4ff', fontWeight: 'bold', backgroundColor: 'rgba(0,212,255,0.05)', padding: '1px 5px', borderRadius: '4px', border: '1px solid rgba(0,212,255,0.1)' };

const balanceValueStyle = { fontSize: '24px', fontFamily: 'monospace', fontWeight: 'bold', color: '#00d4ff', lineHeight: '1' };
const balanceLabelStyle = { color: '#333', fontSize: '8px', fontWeight: '900', marginTop: '4px', letterSpacing: '0.5px' };
const emptyStateCardStyle = { backgroundColor: '#070707', border: '1px dashed #151515', padding: '40px', borderRadius: '24px', textAlign: 'center', width: '100%', boxSizing: 'border-box' };

export default SeagullExplorer;
