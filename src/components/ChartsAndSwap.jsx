import React, { useState, useEffect } from 'react';
import { TrendingUp, Activity } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import axios from 'axios'; 
import Swap from './Swap'; // 🦅 Injecting your sub-component swap engine cleanly here

const SYSTEM_TRACKS = [
  { key: 'SGC_XRP',  name: 'SGC / XRP (XRPL)',   color: '#00d4ff' },
  { key: 'SGH_XRP',  name: 'SGH / XRP (XRPL)',   color: '#00ffcc' },
  { key: 'SGC_FLR',  name: 'SGC / FLR (Flare)',  color: '#ffffff' },
  { key: 'SGC_XDC',  name: 'SGC / XDC (XinFin)', color: '#ffcc00' },
  { key: 'SGH_XLM',  name: 'SGH / XLM (Stellar)',color: '#0088ff' },
  { key: 'SGH_HBAR', name: 'SGH / HBAR (Hedera)',color: '#ff4444' }
]; 

// 🦅 TECHNICAL OSCILLATOR COMPUTATION MATRICES
function calculateRSI(data, key, period = 14) {
  if (data.length <= period) return Array(data.length).fill(50);
  let rsiValues = Array(period).fill(50);
  let gains = 0, losses = 0; 

  for (let i = 1; i <= period; i++) {
    let diff = data[i][key] - data[i - 1][key];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period; let avgLoss = losses / period;
  rsiValues.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)); 

  for (let i = period + 1; i < data.length; i++) {
    let diff = data[i][key] - data[i - 1][key];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsiValues.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsiValues;
} 

function calculateEMA(data, key, period) {
  let k = 2 / (period + 1);
  let ema = [data[0][key]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i][key] * k + ema[i - 1] * (1 - k));
  }
  return ema;
} 

export default function ChartsAndSwap({ userAddress }) { // 🦅 Inheriting wallet access state props from wrapper
  const [timeframe, setTimeframe] = useState('1M');
  const [scaleType, setScaleType] = useState('log'); 
  const [activeIndicator, setActiveIndicator] = useState('RSI'); 
  const [primaryFocusAsset, setPrimaryFocusAsset] = useState('SGC_XRP');
  const [timelineData, setTimelineData] = useState([]);
  const [indicatorData, setIndicatorData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState(SYSTEM_TRACKS.map(t => ({ ...t, visible: true }))); 

  useEffect(() => {
    const loadDatabaseHistoryPoints = async () => {
      try {
        const res = await axios.get(`/api/prices/live-matrix?historical=true&timeframe=${timeframe}`);
        if (res.data && res.data.success && res.data.history && res.data.history.length > 0) { 

          const formatted = res.data.history.map((doc, idx) => {
            const parseRawVal = (val) => (!val || isNaN(val)) ? 0 : parseFloat(val);
            const dateObj = new Date(doc.timestamp); 

            let axisLabel = timeframe === '1H' || timeframe === '1D'
              ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' }); 

            return {
              time: `${axisLabel}${'\u00A0'.repeat(idx % 3)}`,
              fullDate: dateObj.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
              SGC_XRP: parseRawVal(doc.SGC_XRP),
              SGH_XRP: parseRawVal(doc.SGH_XRP),
              SGC_FLR: parseRawVal(doc.SGC_FLR),
              SGC_XDC: parseRawVal(doc.SGC_XDC),
              SGH_XLM: parseRawVal(doc.SGH_XLM),
              SGH_HBAR: parseRawVal(doc.SGH_HBAR)
            };
          }); 

          const chronological = formatted.reverse();
          setTimelineData(chronological); 

          if (chronological.length > 0) {
            const rsiVals = calculateRSI(chronological, primaryFocusAsset);
            const ema12 = calculateEMA(chronological, primaryFocusAsset, 12);
            const ema26 = calculateEMA(chronological, primaryFocusAsset, 26); 

            const compiledIndicators = chronological.map((d, i) => {
              const macdLine = ema12[i] - ema26[i];
              return {
                time: d.time,
                RSI: parseFloat(rsiVals[i].toFixed(2)),
                MACD: parseFloat(macdLine.toExponential(4)),
                Signal: parseFloat((macdLine * 0.9).toExponential(4))
              };
            });
            setIndicatorData(compiledIndicators);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error("Database tracking sync dropped:", err.message);
      }
    }; 

    loadDatabaseHistoryPoints();
    const interval = setInterval(loadDatabaseHistoryPoints, 15000);
    return () => clearInterval(interval);
  }, [timeframe, primaryFocusAsset]); 

  const toggleTrack = (key) => {
    setTracks(tracks.map(t => t.key === key ? { ...t, visible: !t.visible } : t));
  }; 

  return (
    // 🦅 MERGE LAYER: Splits the screen grid into visual graphs on the left and the transaction engine on the right
    <div style={s.masterGrid}>
      <div style={s.container}>
        <div style={s.panel}> 

          {/* HEADER CONTROLS INTERFACE */}
          <div style={s.header}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={18} color="#00ffcc" />
                <h3 style={s.title}>SEAGULL MACRO QUANT LEDGER</h3>
              </div>
              <span style={{ fontSize: '8px', color: '#555', fontFamily: 'monospace', marginTop: '2px' }}>
                SCALE METRIC: {scaleType.toUpperCase()} // OSCILLATOR FOCUS: {primaryFocusAsset}
              </span>
            </div> 

            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={s.btnGroup}>
                <button onClick={() => setScaleType('linear')} style={{...s.toggleBtn, background: scaleType === 'linear' ? '#161616' : 'transparent', color: scaleType === 'linear' ? '#00ffcc' : '#444' }}>LIN</button>
                <button onClick={() => setScaleType('log')} style={{...s.toggleBtn, background: scaleType === 'log' ? '#161616' : 'transparent', color: scaleType === 'log' ? '#00ffcc' : '#444' }}>LOG</button>
              </div> 

              <div style={s.btnGroup}>
                {['1H', '1D', '1W', '1M', 'ALL'].map(tf => (
                  <button key={tf} onClick={() => setTimeframe(tf)} style={{ ...s.tfBtn, background: timeframe === tf ? '#00ffcc' : 'transparent', color: timeframe === tf ? '#000' : '#555' }}>{tf}</button>
                ))}
              </div>
            </div>
          </div> 

          {/* PILL CONTROLS WITH TARGETED TA TRIGGERING FEATURE */}
          <div style={s.toggles}>
            {tracks.map(t => (
              <div key={t.key} style={{ display: 'flex', alignItems: 'center', background: '#000', borderRadius: '10px', border: '1px solid #141414', paddingRight: '4px' }}>
                <button onClick={() => toggleTrack(t.key)} style={{ ...s.pillBtn, color: t.visible ? '#fff' : '#444', borderColor: t.visible ? t.color : 'transparent' }}>
                  <span style={{ color: t.visible ? t.color : '#333', marginRight: '6px' }}>●</span> {t.name}
                </button>
                <button
                  onClick={() => setPrimaryFocusAsset(t.key)}
                  style={{ ...s.focusBtn, backgroundColor: primaryFocusAsset === t.key ? t.color : 'transparent', color: primaryFocusAsset === t.key ? '#000' : '#444' }}
                >
                  TA
                </button>
              </div>
            ))}
          </div> 

          {/* PRICE RATIO CHART VIEWPORT */}
          <div style={s.chartContainer}>
            {loading || timelineData.length === 0 ? (
              <div style={s.loader}>📡 SCANNING LEDGER CROSSINGS...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid stroke="#0c0c0c" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" stroke="#222" style={{ fontSize: '8px', fontFamily: 'monospace' }} />
                  <YAxis
                    stroke="#222"
                    style={{ fontSize: '9px', fontFamily: 'monospace' }}
                    scale={scaleType}
                    domain={scaleType === 'log' ? [0.000000001, 0.01] : ['auto', 'auto']}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(t) => t < 0.00001 ? t.toExponential(1) : t.toFixed(5)}
                  />
                  <Tooltip
                    labelFormatter={(l, items) => items[0]?.payload?.fullDate || l}
                    contentStyle={{ background: '#050505', border: '1px solid #1a1a1a', color: '#fff', fontSize: '11px', fontFamily: 'monospace' }}
                    formatter={(value) => [value < 0.00001 ? value.toFixed(11) : value.toFixed(8)]}
                  />
                  {tracks.map(t => t.visible && (
                    <Area key={t.key} type="monotone" dataKey={t.key} name={t.name} stroke={t.color} fill={t.color} fillOpacity={0.005} strokeWidth={1.5} dot={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div> 

          {/* QUANT TECHNICAL ANALYSIS OVERLAYS */}
          <div style={s.indicatorSection}>
            <div style={s.indicatorHeader}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Activity size={12} color="#00ffcc" />
                <span style={s.indicatorTitle}>CROSS-LEDGER MOMENTUM INDICATORS ({primaryFocusAsset})</span>
              </div>
              <div style={s.btnGroup}>
                <button onClick={() => setActiveIndicator('RSI')} style={{...s.toggleBtn, color: activeIndicator === 'RSI' ? '#00ffcc' : '#444' }}>RSI (14)</button>
                <button onClick={() => setActiveIndicator('MACD')} style={{...s.toggleBtn, color: activeIndicator === 'MACD' ? '#00ffcc' : '#444' }}>MACD</button>
              </div>
            </div> 

            <div style={s.indicatorChartContainer}>
              {loading || indicatorData.length === 0 ? (
                <div style={s.miniLoader}>RUNNING SYSTEM MATH...</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={indicatorData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid stroke="#0c0c0c" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="time" hide />
                    {activeIndicator === 'RSI' ? (
                      <>
                        <YAxis stroke="#222" style={{ fontSize: '8px', fontFamily: 'monospace' }} domain={[0, 100]} ticks={[30, 50, 70]} />
                        <Tooltip contentStyle={{ background: '#050505', border: '1px solid #1a1a1a', color: '#fff', fontSize: '11px', fontFamily: 'monospace' }} />
                        <Line type="monotone" dataKey="RSI" name="RSI" stroke="#ffcc00" dot={false} strokeWidth={1.2} />
                      </>
                    ) : (
                      <>
                        <YAxis stroke="#222" style={{ fontSize: '8px', fontFamily: 'monospace' }} domain={['auto', 'auto']} tickFormatter={(t) => t.toExponential(0)} />
                        <Tooltip contentStyle={{ background: '#050505', border: '1px solid #1a1a1a', color: '#fff', fontSize: '11px', fontFamily: 'monospace' }} />
                        <Line type="monotone" dataKey="MACD" name="MACD" stroke="#00ffcc" dot={false} strokeWidth={1.2} />
                        <Line type="monotone" dataKey="Signal" name="Signal Line" stroke="#ff4444" strokeDasharray="2 2" dot={false} strokeWidth={1} />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div> 

        </div>
      </div>

      {/* 🦅 SWAP INTERFACE CODES SIDEBAR PANEL INJECTION */}
      <div style={s.swapSidebar}>
        <Swap userAddress={userAddress} />
      </div>
    </div>
  );
} 

const s = {
  masterGrid: { display: 'flex', flexWrap: 'wrap', gap: '20px', width: '100%', maxWidth: '1400px', margin: '0 auto', padding: '10px', boxSizing: 'border-box' },
  container: { flex: '2 1 600px', display: 'flex', boxSizing: 'border-box', minWidth: '320px' },
  swapSidebar: { flex: '1 1 350px', minWidth: '320px' },
  panel: { flex: 1, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '24px', padding: '25px', display: 'flex', flexDirection: 'column', width: '100%' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' },
  title: { margin: 0, fontSize: '12px', fontWeight: '900', letterSpacing: '1px', color: '#fff', fontFamily: 'sans-serif' },
  btnGroup: { display: 'flex', background: '#000', padding: '2px', borderRadius: '8px', border: '1px solid #161616' },
  toggleBtn: { border: 'none', background: 'transparent', padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer', outline: 'none', fontFamily: 'monospace' },
  tfBtn: { border: '1px solid transparent', padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', borderRadius: '6px', cursor: 'pointer', outline: 'none' },
  toggles: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px' },
  pillBtn: { border: '1px solid transparent', background: 'transparent', padding: '6px 12px', fontSize: '10px', fontWeight: 'bold', borderRadius: '8px', cursor: 'pointer', outline: 'none' },
  focusBtn: { border: 'none', borderRadius: '6px', padding: '2px 6px', fontSize: '8px', fontWeight: 'black', cursor: 'pointer', marginLeft: '2px', fontFamily: 'monospace' },
  chartContainer: { flex: 1, minHeight: '260px', background: '#000', border: '1px solid #111', borderRadius: '16px', padding: '15px 10px 5px 10px', boxSizing: 'border-box' },
  indicatorSection: { marginTop: '15px', background: '#000', border: '1px solid #111', borderRadius: '16px', padding: '12px' },
  indicatorHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  indicatorTitle: { fontSize: '9px', fontWeight: 'bold', color: '#666', fontFamily: 'monospace', letterSpacing: '0.5px' },
  indicatorChartContainer: { height: '80px', width: '100%' },
  loader: { color: '#00ffcc', fontSize: '10px', textAlign: 'center', paddingTop: '110px', fontFamily: 'monospace' },
  miniLoader: { color: '#ffcc00', fontSize: '8px', textAlign: 'center', paddingTop: '25px', fontFamily: 'monospace' }
};
