import React, { useState, useEffect } from 'react'; // 🎯 Added useEffect here
import axios from 'axios';

const SeagullExplorer = ({ standalone = false }) => { // 🎯 Destructured standalone prop safely
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(standalone ? [] : null); // 🎯 Initialized to empty array if standalone so layout unblocks
  const [loading, setLoading] = useState(false);

  // 🎯 CACHE SNAPSHOT ENGINE DATA PIPELINES                                                                  
  const [globalMetrics, setGlobalMetrics] = useState({ sgcTopBalances: [], sgcshTopBalances: [] });
  const [activeTab, setActiveTab] = useState(standalone ? 'richlist' : 'search'); // 🎯 Automatically loads richlist tab first if standalone                                                     
  
  // 🎯 SUB-FILTERS: Multi-chain distribution triggers
  const [sgcChainFilter, setSgcChainFilter] = useState('ALL');   // Options: 'ALL', 'XRPL', 'XDC', 'FLARE'
  const [sgcshChainFilter, setSgcshChainFilter] = useState('ALL'); // Options: 'ALL', 'XRPL', 'HEDERA', 'STELLAR'                                                                                                       
  
  // 🎯 NEW: Interactive page depth indices for mobile screen boundaries
  const [sgcPage, setSgcPage] = useState(1);
  const [sgcshPage, setSgcshPage] = useState(1);
  const RECORDS_PER_PAGE = 10;

  const expandedIndex = expandedIndexState => {
    const [val, setVal] = useState(null);
    return [val, setVal];
  };
  const [expandedIndexVal, setExpandedIndexVal] = useState(null);
  const [activeIsoTxHash, setActiveIsoTxHash] = useState(null);

  const ASSET_LOGOS = {
    'XRPL': 'https://files.catbox.moe/kl2ii3.png',
    'XRP': 'https://files.catbox.moe/kl2ii3.png',
    'XLM': 'https://files.catbox.moe/evgd8n.png',
    'HBAR': 'https://files.catbox.moe/ixe2t4.jpg',
    'FLARE': 'https://files.catbox.moe/q0eg3r.png',
    'FLR': 'https://files.catbox.moe/q0eg3r.png',
    'XDC': 'https://files.catbox.moe/6k7cu1.jpg',
    'SGC': 'https://files.catbox.moe/utrpfc.png',
    'SGCN': 'https://files.catbox.moe/utrpfc.png',
    'SeagullCoin': 'https://files.catbox.moe/utrpfc.png',
    'SGCSH': 'https://files.catbox.moe/w3cets.png',
    'SeagullCash': 'https://files.catbox.moe/w3cets.png'
  };

  // 🎯 NEW SYSTEM PIPELINE: Automatically fetch the rich lists on mount if hit via public URL
  useEffect(() => {
    const fetchGlobalMetricsOnLoad = async () => {
      setLoading(true);
      try {
        // Pings your underlying multi-chain data compiler endpoint directly
        const res = await axios.get('/api/explorer/scout/richlist-preload'); 
        if (res.data && res.data.richlist) {
          setGlobalMetrics(res.data.richlist);
        }
      } catch (err) {
        console.error("🦅 Background stats preload failed:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchGlobalMetricsOnLoad();
  }, []);

  const handleSearch = async () => {
    if (!search) return;
    setLoading(true);
    setResults(null);
    setExpandedIndexVal(null);
    setActiveIsoTxHash(null);
    try {
      const res = await axios.get(`/api/explorer/scout/${search.trim()}`);
      if (res.data && res.data.success) {
        setResults(res.data.data);
        if (res.data.richlist) {
          setGlobalMetrics(res.data.richlist);
        }
        setActiveTab('search');
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

  const toggleCardTransactions = (index) => {
    setExpandedIndexVal(expandedIndexVal === index ? null : index);
    setActiveIsoTxHash(null);
  };

  return (
    <div style={containerStyle}>
      <div style={oceanSkyGradient}></div>
      <div style={synthwaveHorizonLine}></div>
      <div style={perspectiveBeachGrid}></div>
      <div style={neonSunGlow}></div>
      <div style={ambientWaterReflection}></div>                                                            

      <div style={uiCanvasFrame}>
        <div style={{ textAlign: 'center', marginBottom: '30px', position: 'relative', width: '100%' }}>
          <div style={logoBadgeStyle}>𓅰</div>
          <h1 style={titleStyle}>
            SEAGULL <span style={{ color: '#00d4ff', textShadow: '0 0 20px #00d4ff, 0 0 40px #0055ff' }}>EXPLORER</span>
          </h1>
          <p style={subtitleStyle}>Bored Seagull Club L2 Explorer // ISO 20022 Block Explorer</p>
        </div>

        {/* Hide search container from the clean public view if desired, or leave it active */}
        <div style={searchContainerStyle}>
          <div style={inputPrefixStyle}>Address:</div>
          <input
            type="text"
            placeholder="ISO Address (r... / G... / 0x...)"
            style={inputFieldStyle}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch} style={scoutButtonStyle}>
            {loading ? 'SCANNING...' : 'Search'}
          </button>
        </div>
                                                                                                                    
        {results && !loading && (
          <div style={tabContainerStyle}>
            {!standalone && ( // 🎯 Skip the search tab if someone isn't inside the active app session
              <button
                onClick={() => setActiveTab('search')}
                style={{...tabButtonStyle, color: activeTab === 'search' ? '#00ffcc' : '#6c7d93', borderBottomColor: activeTab === 'search' ? '#00ffcc' : 'transparent'}}
              >
                🔭 SCOUT IDENTITY REPORT
              </button>
            )}
            <button
              onClick={() => setActiveTab('richlist')}
              style={{...tabButtonStyle, color: activeTab === 'richlist' ? '#ff007f' : '#6c7d93', borderBottomColor: activeTab === 'richlist' ? '#ff007f' : 'transparent'}}
            >
              👑 ECOSYSTEM RICHLISTS
            </button>
          </div>
        )}

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
          {loading && (
            <div style={{ textAlign: 'center', margin: '40px 0' }}>
              <p style={loadingStatusStyle}>Pinging network array relays...</p>
              <div style={loadingPulseBar}></div>
            </div>
          )}

          {/* 🎯 NAVIGATION ROUTE A: SEARCH RESULTS LOOKUP VIEW */}
          {!loading && activeTab === 'search' && results && results.length > 0 && (
            <>
              <div style={tableHeaderStyle}>
                <span>EXTRACTED FINANCIAL QUANTITIES</span>
                <span style={liveBadgeStyle}>CONNECTED MAINNET</span>
              </div>                                                                                        
              {results.map((asset, i) => {
                const isExpanded = expandedIndexVal === i;
                const rawBalance = typeof asset.balance === 'number' ? asset.balance : parseFloat(asset.balance || 0);
                const formattedBalance = isNaN(rawBalance) ? "0.00" : rawBalance.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6
                });
                const cleanIssuer = asset.issuer && asset.issuer !== 'Native'
                  ? `${asset.issuer.slice(0, 8)}...${asset.issuer.slice(-8)}`
                  : 'Core Chain Security Anchor';
                const fallbackLogo = "https://cryptologos.cc/logos/xrp-xrp-logo.png";
                const assetSymbolKey = asset.symbol || asset.ticker || 'XRP';
                const historyList = asset.history || [];

                return (
                  <div key={i} style={{ marginBottom: '16px', width: '100%', minWidth: '0' }}>
                    <div
                      onClick={() => toggleCardTransactions(i)}
                      style={{
                        ...resultCardStyle,
                        borderColor: isExpanded ? '#00ffcc' : 'rgba(255, 255, 255, 0.05)',
                        background: isExpanded ? 'rgba(10, 25, 40, 0.55)' : 'rgba(5, 10, 15, 0.4)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '0', flex: 1 }}>
                        <div style={logoWrapperStyle}>
                          <img
                            src={ASSET_LOGOS[assetSymbolKey] || ASSET_LOGOS[asset.chain] || fallbackLogo}
                            alt={asset.chain}
                            style={logoImageStyle}
                            onError={(e) => { e.target.src = fallbackLogo; }}
                          />
                        </div>
                        <div style={{ minWidth: '0', flex: 1 }}>
                          <h4 style={assetNameStyle}>{asset.name}</h4>
                          <div style={metaDataStyle}>
                            <span style={chainBadgeStyle(asset.chain)}>{asset.chain}</span>
                            <span style={{ color: 'rgba(255,255,255,0.1)' }}>•</span>
                            <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanIssuer}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '15px', flexShrink: 0 }}>
                        <div>
                          <div style={balanceValueStyle}>{formattedBalance}</div>
                          <div style={balanceLabelStyle}>{assetSymbolKey} POOL</div>
                        </div>
                        <div style={{ color: isExpanded ? '#00ffcc' : '#444', fontSize: '10px' }}>
                          {isExpanded ? '▲' : '▼'}
                        </div>
                      </div>
                    </div>
                                                                                                                                
                    {isExpanded && (
                      <div style={drawerPanelStyle}>
                        <div style={drawerMetaLine}>
                          <span style={{ color: '#00ffcc' }}>🗲 REAL-TIME NETWORK TELEMETRY FEED</span>
                        </div>
                        {historyList.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                            {historyList.map((tx, txIdx) => {
                              const isTxDetailOpen = activeIsoTxHash === tx.hash;
                              return (
                                <div key={txIdx} style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveIsoTxHash(isTxDetailOpen ? null : tx.hash);
                                    }}
                                    style={{...txRowStyle, borderColor: isTxDetailOpen ? '#00ffcc' : 'rgba(255,255,255,0.02)'}}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '0', flex: 1 }}>
                                      <span style={{
                                        color: tx.type === 'SEND' ? '#ff3366' : '#00ffcc',                  
                                        fontWeight: 'bold',
                                        fontSize: '10px',
                                        fontFamily: 'monospace',
                                        flexShrink: 0
                                      }}>
                                        {tx.type === 'SEND' ? '[-] OUT' : '[+] IN'}
                                      </span>
                                      <div style={{ minWidth: '0', flex: 1 }}>
                                        <div style={txHashTextStyle}>                                       
                                          {tx.messageType || 'pacs.008'} // {tx.hash ? `${tx.hash.slice(0, 10)}...${tx.hash.slice(-10)}` : 'UNKNOWN'}
                                        </div>
                                        <div style={txCounterpartyStyle}>                                   
                                          {tx.type === 'SEND' ? `Dest: ${tx.counterparty}` : `Src: ${tx.counterparty}`}
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: '10px' }}>
                                      <div style={{
                                        fontFamily: 'monospace',
                                        fontSize: '13px',
                                        fontWeight: '900',
                                        color: tx.type === 'SEND' ? '#ff3366' : '#00ffcc'
                                      }}>
                                        {tx.type === 'SEND' ? '-' : '+'}{parseFloat(tx.amount || 0).toFixed(4)}
                                      </div>
                                      <div style={txTimeStyle}>{tx.timestamp ? tx.timestamp.split(',')[0] : 'N/A'}</div>
                                    </div>
                                  </div>
                                  {isTxDetailOpen && (
                                    <div style={isoTerminalWrapperStyle}>
                                      <div style={terminalHeaderBar}>
                                        <span>Document Viewer // UETR: {tx.uetr || 'N/A'}</span>
                                        <span style={{color: '#ff007f'}}>RAW_LOG</span>
                                      </div>
                                      {tx.remittanceInfo && (
                                        <div style={{color: '#00d4ff', fontSize: '10px', marginBottom: '8px', borderBottom: '1px solid #222', paddingBottom: '6px'}}>
                                          <span style={{color: '#666'}}>Remittance Info:</span> {tx.remittanceInfo}
                                        </div>
                                      )}
                                      <pre style={rawPayloadCodeBlock}>
                                        {JSON.stringify(tx.rawPayload, null, 2)}                            
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={txStatusTextStyle}>No recent historical transactions caught on this layer.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}                                                                                                
          
          {/* 🎯 NAVIGATION ROUTE B: SIDE-BY-SIDE LEDGER LEADERBOARDS */}                                   
          {!loading && activeTab === 'richlist' && (
            <div style={leaderboardGridStyle}>
              {/* LEFT COLUMN: SEAGULLCOIN (SGC) LEADERBOARD */}
              <div style={boardColumnStyle}>
                <div style={subTableHeaderStyle}>
                  <span style={{color: '#00d4ff', fontSize: '10px', fontWeight: 'bold'}}>👑 SEAGULLCOIN WHALES (SGC)</span>
                  <div style={buttonGroupStyle}>
                    {['ALL', 'XRPL', 'XDC', 'FLARE'].map((opt) => (
                      <button
                        key={opt}
                        onClick={() => { setSgcChainFilter(opt); setSgcPage(1); }}
                        style={filterButtonStyle(sgcChainFilter === opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>                                                                                      
                {(() => {
                  const filtered = (globalMetrics.sgcTopBalances || []).filter(w => sgcChainFilter === 'ALL' || w.chain.toUpperCase() === sgcChainFilter);
                  const startIndex = (sgcPage - 1) * RECORDS_PER_PAGE;
                  const pageRows = filtered.slice(startIndex, startIndex + RECORDS_PER_PAGE);
                  const totalPages = Math.ceil(filtered.length / RECORDS_PER_PAGE) || 1;                    
                  return (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '440px' }}>
                        {pageRows.length > 0 ? (
                          pageRows.map((whale, idx) => (
                            <div key={idx} style={leaderRowStyle}>
                              <div style={{display: 'flex', alignItems: 'center', gap: '10px', minWidth: '0', flex: 1}}>
                                <span style={rankBadgeStyle}>{startIndex + idx + 1}</span>
                                <span style={whaleAddressStyle}>{whale.wallet}</span>                       
                              </div>
                              <div style={{textAlign: 'right', flexShrink: 0}}>
                                <div style={leaderBalanceValueStyle}>{parseFloat(whale.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                <span style={chainBadgeStyle(whale.chain)}>{whale.chain}</span>             
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={emptyStateCardStyle}>No SGC snapshots cached for this filter layer.</div>
                        )}
                      </div>

                      {filtered.length > RECORDS_PER_PAGE && (
                        <div style={paginationFooterStyle}>
                          <button disabled={sgcPage === 1} onClick={() => setSgcPage(p => p - 1)} style={pageNavButtonStyle(sgcPage === 1)}>◀ PREV</button>
                          <span style={pageIndicatorStyle}>PAGE {sgcPage} / {totalPages}</span>
                          <button disabled={sgcPage === totalPages} onClick={() => setSgcPage(p => p + 1)} style={pageNavButtonStyle(sgcPage === totalPages)}>NEXT ▶</button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>                                                                                        
              
              {/* RIGHT COLUMN: SEAGULLCASH (SGCSH) LEADERBOARD */}
              <div style={boardColumnStyle}>
                <div style={subTableHeaderStyle}>
                  <span style={{color: '#ff007f', fontSize: '10px', fontWeight: 'bold'}}>👑 SEAGULLCASH WHALES (SGCSH)</span>
                  <div style={buttonGroupStyle}>
                    {['ALL', 'XRPL', 'HEDERA', 'STELLAR'].map((opt) => (
                      <button
                        key={opt}
                        onClick={() => { setSgcshChainFilter(opt); setSgcshPage(1); }}
                        style={filterButtonStyle(sgcshChainFilter === opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                {(() => {
                  const filtered = (globalMetrics.sgcshTopBalances || []).filter(w => sgcshChainFilter === 'ALL' || w.chain.toUpperCase() === sgcshChainFilter);
                  const startIndex = (sgcshPage - 1) * RECORDS_PER_PAGE;
                  const pageRows = filtered.slice(startIndex, startIndex + RECORDS_PER_PAGE);
                  const totalPages = Math.ceil(filtered.length / RECORDS_PER_PAGE) || 1;
                  return (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '440px' }}>
                        {pageRows.length > 0 ? (
                          pageRows.map((whale, idx) => (
                            <div key={idx} style={leaderRowStyle}>
                              <div style={{display: 'flex', alignItems: 'center', gap: '10px', minWidth: '0', flex: 1}}>
                                <span style={{...rankBadgeStyle, color: '#ff007f', borderColor: 'rgba(255,0,127,0.2)'}}>{startIndex + idx + 1}</span>
                                <span style={whaleAddressStyle}>{whale.wallet}</span>
                              </div>
                              <div style={{textAlign: 'right', flexShrink: 0}}>
                                <div style={leaderBalanceValueStyle}>{parseFloat(whale.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                <span style={chainBadgeStyle(whale.chain)}>{whale.chain}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={emptyStateCardStyle}>No SGCSH snapshots cached for this filter layer.</div>
                        )}
                      </div>
                                                                                                                                  
                      {filtered.length > RECORDS_PER_PAGE && (
                        <div style={paginationFooterStyle}>
                          <button disabled={sgcshPage === 1} onClick={() => setSgcshPage(p => p - 1)} style={pageNavButtonStyle(sgcshPage === 1)}>◀ PREV</button>
                          <span style={pageIndicatorStyle}>PAGE {sgcshPage} / {totalPages}</span>
                          <button disabled={sgcshPage === totalPages} onClick={() => setSgcshPage(p => p + 1)} style={pageNavButtonStyle(sgcshPage === totalPages)}>NEXT ▶</button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>                                                                                        
            </div>
          )}
                                                                                                                      
          {!loading && results && results.length === 0 && activeTab === 'search' && (
            <div style={emptyStateCardStyle}>
              <p style={{ margin: 0, color: '#555', fontSize: '11px', letterSpacing: '1px' }}>
                ⚠️ NO LEDGER ALLOCATIONS FOUND FOR THIS IDENTITY TARGET.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};                                                                                                          

// ==========================================                                                               
// STYLES MATRIX                                                                                            
// ==========================================                                                               
const containerStyle = { minHeight: '100vh', backgroundColor: '#02050a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 12px', position: 'relative', overflowX: 'hidden', color: '#fff', boxSizing: 'border-box' };
const oceanSkyGradient = { position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, #010a15 0%, #051932 40%, #1a0b2e 70%, #0d2646 100%)', zIndex: 1 };
const synthwaveHorizonLine = { position: 'absolute', top: '55%', left: 0, width: '100%', height: '2px', background: 'linear-gradient(90deg, transparent, #00d4ff, #ff007f, #00d4ff, transparent)', zIndex: 2, opacity: 0.6 };
const perspectiveBeachGrid = { position: 'absolute', top: '55%', bottom: 0, left: '-50%', right: '-50%', backgroundImage: 'linear-gradient(rgba(0, 212, 255, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 212, 255, 0.15) 1px, transparent 1px)', backgroundSize: '50px 50px', transform: 'perspective(180px) rotateX(65deg)', transformOrigin: 'top center', zIndex: 2, opacity: 0.5 };
const neonSunGlow = { position: 'absolute', top: '25%', left: '50%', transform: 'translate(-50%, -50%)', width: '100%', maxWidth: '500px', height: '500px', background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, rgba(255,0,127,0.03) 50%, transparent 100%)', filter: 'blur(60px)', pointerEvents: 'none', zIndex: 2 };
const ambientWaterReflection = { position: 'absolute', bottom: 0, left: 0, width: '100%', height: '40%', background: 'linear-gradient(to top, rgba(0, 255, 204, 0.04), transparent)', pointerEvents: 'none', zIndex: 3 };
const uiCanvasFrame = { width: '100%', maxWidth: '720px', position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '0' };
const logoBadgeStyle = { width: '54px', height: '54px', borderRadius: '16px', border: '1px solid rgba(0, 212, 255, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', backgroundColor: 'rgba(5, 15, 25, 0.8)', marginBottom: '16px', boxShadow: '0 0 30px rgba(0,212,255,0.2)', color: '#00d4ff', lineHeight: '54px', textAlign: 'center' };
const titleStyle = { margin: 0, fontSize: '32px', fontWeight: '900', fontStyle: 'italic', letterSpacing: '-1px', textTransform: 'uppercase', textAlign: 'center' };
const subtitleStyle = { margin: '6px 0 0 0', fontSize: '8px', color: '#6c7d93', letterSpacing: '2px', fontWeight: 'bold', fontFamily: 'monospace', textAlign: 'center' };
const searchContainerStyle = { width: '100%', backgroundColor: 'rgba(4, 12, 22, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '16px', display: 'flex', alignItems: 'center', overflow: 'hidden', marginBottom: '30px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', boxSizing: 'border-box' };
const inputPrefixStyle = { paddingLeft: '16px', color: '#ff007f', fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', flexShrink: 0 };
const inputFieldStyle = { width: '100%', backgroundColor: 'transparent', border: 'none', padding: '18px 12px', outline: 'none', color: '#fff', fontFamily: 'monospace', fontSize: '12px', boxSizing: 'border-box', minWidth: '0' };
const scoutButtonStyle = { padding: '0 24px', height: '54px', backgroundColor: '#00d4ff', color: '#000', fontWeight: '900', fontStyle: 'italic', border: 'none', cursor: 'pointer', fontSize: '12px', letterSpacing: '0.5px', flexShrink: 0 };
const tableHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px', fontSize: '8px', fontWeight: 'bold', letterSpacing: '1px', width: '100%', marginBottom: '10px', color: '#4a5d78', fontFamily: 'monospace' };
const liveBadgeStyle = { color: '#00ffcc', backgroundColor: 'rgba(0,255,204,0.03)', border: '1px solid rgba(0,255,204,0.12)', padding: '3px 8px', borderRadius: '6px' };
const resultCardStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.04)', borderRadius: '16px', padding: '16px 20px', width: '100%', boxSizing: 'border-box', cursor: 'pointer', transition: 'all 0.2s ease-in-out', gap: '10px' };
const logoWrapperStyle = { width: '38px', height: '38px', backgroundColor: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', boxSizing: 'border-box', flexShrink: 0 };
const logoImageStyle = { width: '100%', height: '100%', objectFit: 'contain' };
const assetNameStyle = { margin: 0, fontSize: '16px', fontWeight: '900', fontStyle: 'italic', textTransform: 'uppercase', tracking: '-0.5px' };
const metaDataStyle = { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontFamily: 'monospace', fontSize: '9px', minWidth: '0' };
const balanceValueStyle = { fontSize: '20px', fontFamily: 'monospace', fontWeight: 'bold', color: '#fff', lineHeight: '1' };
const balanceLabelStyle = { color: '#4a5d78', fontSize: '7px', fontWeight: '900', marginTop: '4px', letterSpacing: '0.5px', fontFamily: 'monospace' };
const loadingStatusStyle = { textTransform: 'uppercase', fontFamily: 'monospace', fontSize: '9px', color: '#00d4ff', letterSpacing: '1px', marginBottom: '8px' };
const loadingPulseBar = { width: '120px', height: '2px', background: 'linear-gradient(90deg, transparent, #00ffcc, transparent)', margin: '0 auto', animation: 'scanWave 1.4s infinite linear' };
const emptyStateCardStyle = { backdropFilter: 'blur(10px)', border: '1px dashed rgba(255,255,255,0.05)', padding: '40px 20px', borderRadius: '16px', textAlign: 'center', width: '100%', background: 'rgba(0,0,0,0.2)' };
const drawerPanelStyle = { background: 'rgba(2, 6, 12, 0.9)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.04)', borderTop: 'none', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px', padding: '16px', marginTop: '-10px', position: 'relative', zIndex: 5, boxShadow: 'inset 0 10px 20px rgba(0,0,0,0.6)', width: '100%', boxSizing: 'border-box' };
const drawerMetaLine = { fontSize: '8px', fontFamily: 'monospace', color: '#4a5d78', letterSpacing: '0.5px', marginBottom: '12px' };
const txStatusTextStyle = { fontSize: '10px', fontFamily: 'monospace', color: '#4a5d78', textAlign: 'center', padding: '10px 0' };
const txRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer', width: '100%', boxSizing: 'border-box', gap: '8px', transition: 'border 0.2s' };
const txHashTextStyle = { fontFamily: 'monospace', fontSize: '10px', color: '#eee', fontWeight: 'bold' };
const txCounterpartyStyle = { fontFamily: 'monospace', fontSize: '9px', color: '#555', marginTop: '2px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const txTimeStyle = { fontSize: '8px', color: '#3a4b61', marginTop: '2px', fontFamily: 'monospace' };
const isoTerminalWrapperStyle = { background: '#000', border: '1px solid #222', borderRadius: '8px', padding: '12px', marginTop: '6px', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' };
const terminalHeaderBar = { display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#555', borderBottom: '1px solid #222', paddingBottom: '4px', marginBottom: '8px', fontWeight: 'bold' };
const rawPayloadCodeBlock = { margin: 0, padding: 0, color: '#00ffcc', fontSize: '10px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: '1.4' };

const chainBadgeStyle = (chain) => {
  const colors = { XRPL: '#00d4ff', STELLAR: '#fff', HEDERA: '#00ffcc', FLARE: '#ff3366', XDC: '#9933ff' };
  return { fontWeight: 'bold', color: colors[chain] || '#fff', fontSize: '9px', fontFamily: 'monospace' };  
};

const tabContainerStyle = { display: 'flex', gap: '10px', width: '100%', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.05)', boxSizing: 'border-box' };
const tabButtonStyle = { flex: 1, backgroundColor: 'transparent', border: 'none', borderBottom: '2px solid transparent', padding: '12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', transition: 'all 0.2s ease-in-out', outline: 'none' };
const leaderboardGridStyle = { display: 'flex', width: '100%', gap: '20px', flexWrap: 'wrap', boxSizing: 'border-box' };
const boardColumnStyle = { flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0' };
const leaderRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(5, 12, 22, 0.4)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', padding: '12px 16px', boxSizing: 'border-box', minWidth: '0', gap: '10px' };
const rankBadgeStyle = { width: '22px', height: '22px', borderRadius: '6px', border: '1px solid rgba(0,212,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontFamily: 'monospace', color: '#00d4ff', backgroundColor: 'rgba(0,0,0,0.3)', flexShrink: 0 };
const whaleAddressStyle = { fontFamily: 'monospace', fontSize: '11px', color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const leaderBalanceValueStyle = { fontFamily: 'monospace', fontSize: '14px', fontWeight: 'bold', color: '#fff', lineHeight: '1.2' };
const subTableHeaderStyle = { display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0', width: '100%', marginBottom: '6px' };
const buttonGroupStyle = { display: 'flex', gap: '4px', backgroundColor: 'rgba(0, 0, 0, 0.4)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)', alignSelf: 'flex-start' };

const filterButtonStyle = (isActive) => ({
  padding: '4px 10px',
  fontSize: '9px',
  fontWeight: 'bold',
  fontFamily: 'monospace',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  backgroundColor: isActive ? '#ff007f' : 'transparent',
  color: isActive ? '#fff' : '#6c7d93',
  boxShadow: isActive ? '0 0 10px rgba(255,0,127,0.4)' : 'none',
  transition: 'all 0.15s ease-in-out'
});

const paginationFooterStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', padding: '6px 4px', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)' };
const pageIndicatorStyle = { fontFamily: 'monospace', fontSize: '10px', color: '#6c7d93', fontWeight: 'bold', letterSpacing: '0.5px' };
const pageNavButtonStyle = (isDisabled) => ({
  backgroundColor: isDisabled ? 'transparent' : 'rgba(255, 255, 255, 0.03)',
  border: '1px solid ' + (isDisabled ? 'rgba(255,255,255,0.05)' : 'rgba(0, 212, 255, 0.2)'),
  color: isDisabled ? '#334155' : '#00d4ff',
  padding: '6px 12px',
  borderRadius: '4px',
  fontSize: '9px',
  fontWeight: 'bold',
  fontFamily: 'monospace',
  cursor: isDisabled ? 'not-allowed' : 'pointer',
  transition: 'all 0.15s ease'
});

export default SeagullExplorer;
