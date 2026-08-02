import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Activity } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import axios from 'axios';

const SYSTEM_TRACKS = [
  { key: 'SGC_XRP',  name: 'SGC / XRP',   color: '#00d4ff' },
  { key: 'SGH_XRP',  name: 'SGH / XRP',   color: '#00ffcc' },
  { key: 'SGC_FLR',  name: 'SGC / FLR',   color: '#ffffff' },
  { key: 'SGC_XDC',  name: 'SGC / XDC',   color: '#ffcc00' },
  { key: 'SGH_XLM',  name: 'SGH / XLM',   color: '#0088ff' },
  { key: 'SGH_HBAR', name: 'SGH / HBAR',   color: '#ff4444' }
];

// ⚡ OPTIMIZED TECHNICAL OSCILLATOR COMPUTATION
function calculateRSI(data, key, period = 14) {
  if (!data || data.length <= period) return Array(data?.length || 0).fill(50);
  let rsiValues = Array(period).fill(50);
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    let diff = (data[i]?.[key] || 0) - (data[i - 1]?.[key] || 0);
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period; let avgLoss = losses / period;
  rsiValues.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < data.length; i++) {
    let diff = (data[i]?.[key] || 0) - (data[i - 1]?.[key] || 0);
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsiValues.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsiValues;
}

function calculateEMA(data, key, period) {
  if (!data || data.length === 0) return [];
  let k = 2 / (period + 1);
  let ema = [data[0]?.[key] || 0];
  for (let i = 1; i < data.length; i++) {
    ema.push((data[i]?.[key] || 0) * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export default function ChartsAndSwap() {
  const [timeframe, setTimeframe] = useState('1D'); // Instant load default
  const [scaleType, setScaleType] = useState('log');
  const [activeIndicator, setActiveIndicator] = useState('RSI');
  const [primaryFocusAsset, setPrimaryFocusAsset] = useState('SGC_XRP');
  const [timelineData, setTimelineData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState(SYSTEM_TRACKS.map(t => ({ ...t, visible: true })));

  useEffect(() => {
    let isMounted = true;
    const loadDatabaseHistoryPoints = async () => {
      try {
        const res = await axios.get(`/api/prices/live-matrix?historical=true&timeframe=${timeframe}`);

        if (isMounted && res.data && res.data.success && res.data.history) {
          const rawHistory = res.data.history;
          const maxPoints = timeframe === 'ALL' || timeframe === '1M' ? 120 : rawHistory.length;
          const slicedHistory = rawHistory.slice(0, maxPoints);

          const formatted = slicedHistory.map((doc) => {
            const parseRawVal = (val) => (!val || isNaN(val)) ? 0 : parseFloat(val);
            const dateObj = new Date(doc.timestamp);

            let axisLabel = timeframe === '1H' || timeframe === '1D'
              ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

            return {
              time: axisLabel,
              fullDate: dateObj.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
              SGC_XRP: parseRawVal(doc.SGC_XRP),
              SGH_XRP: parseRawVal(doc.SGH_XRP),
              SGC_FLR: parseRawVal(doc.SGC_FLR),
              SGC_XDC: parseRawVal(doc.SGC_XDC),
              SGH_XLM: parseRawVal(doc.SGH_XLM),
              SGH_HBAR: parseRawVal(doc.SGH_HBAR)
            };
          });

          setTimelineData(formatted.reverse());
          setLoading(false);
        }
      } catch (err) {
        console.error("Database tracking sync dropped:", err.message);
        if (isMounted) setLoading(false);
      }
    };

    loadDatabaseHistoryPoints();
    const interval = setInterval(loadDatabaseHistoryPoints, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [timeframe]);

  // ⚡ MEMOIZE TECHNICAL INDICATORS
  const indicatorData = useMemo(() => {
    if (!timelineData.length) return [];
    const rsiVals = calculateRSI(timelineData, primaryFocusAsset);
    const ema12 = calculateEMA(timelineData, primaryFocusAsset, 12);
    const ema26 = calculateEMA(timelineData, primaryFocusAsset, 26);

    return timelineData.map((d, i) => {
      const macdLine = (ema12[i] || 0) - (ema26[i] || 0);
      return {
        time: d.time,
        RSI: parseFloat((rsiVals[i] || 50).toFixed(2)),
        MACD: parseFloat(macdLine.toExponential(4)),
        Signal: parseFloat((macdLine * 0.9).toExponential(4))
      };
    });
  }, [timelineData, primaryFocusAsset]);

  const toggleTrack = (key) => {
    setTracks(tracks.map(t => t.key === key ? { ...t, visible: !t.visible } : t));
  };

  return (
    <div style={s.masterContainer}>
      <div style={s.panel}>
        
        {/* HEADER CONTROLS */}
        <div style={s.header}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={16} color="#00ffcc" />
              <h3 style={s.title}>SEAGULL MACRO QUANT LEDGER</h3>
            </div>
            <span style={{ fontSize: '7px', color: '#555', fontFamily: 'monospace', marginTop: '2px', display: 'block' }}>
              SCALE: {scaleType.toUpperCase()} // FOCUS: {primaryFocusAsset}
            </span>
          </div>

          <div style={s.controlsRow}>
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

        {/* ASSET SELECTORS */}
        <div style={s.toggles}>
          {tracks.map(t => (
            <div key={t.key} style={{ display: 'flex', alignItems: 'center', background: '#000', borderRadius: '8px', border: '1px solid #141414', paddingRight: '3px' }}>
              <button onClick={() => toggleTrack(t.key)} style={{ ...s.pillBtn, color: t.visible ? '#fff' : '#444' }}>
                <span style={{ color: t.visible ? t.color : '#333', marginRight: '4px' }}>●</span> {t.name}
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

        {/* PRIMARY PRICE RATIO CHART */}
        <div style={s.chartContainer}>
          {loading || timelineData.length === 0 ? (
            <div style={s.loader}>📡 SCANNING CROSS-CHAIN LEDGERS...</div>
          ) : (
            <div style={{ width: '100%', height: '280px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <CartesianGrid stroke="#0c0c0c" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" stroke="#222" style={{ fontSize: '7px', fontFamily: 'monospace' }} interval="preserveStartEnd" />
                  <YAxis
                    stroke="#222"
                    style={{ fontSize: '8px', fontFamily: 'monospace' }}
                    scale={scaleType}
                    domain={scaleType === 'log' ? [0.000000001, 0.01] : ['auto', 'auto']}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(t) => t < 0.00001 ? t.toExponential(1) : t.toFixed(4)}
                  />
                  <Tooltip
                    labelFormatter={(l, items) => items[0]?.payload?.fullDate || l}
                    contentStyle={{ background: '#050505', border: '1px solid #1a1a1a', color: '#fff', fontSize: '10px', fontFamily: 'monospace' }}
                    formatter={(value) => [value < 0.00001 ? value.toFixed(10) : value.toFixed(6)]}
                  />
                  {tracks.map(t => t.visible && (
                    <Area key={t.key} type="monotone" dataKey={t.key} name={t.name} stroke={t.color} fill={t.color} fillOpacity={0.02} strokeWidth={1.5} dot={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* QUANT TECHNICAL ANALYSIS SUB-CHART */}
        <div style={s.indicatorSection}>
          <div style={s.indicatorHeader}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <Activity size={10} color="#00ffcc" />
              <span style={s.indicatorTitle}>MOMENTUM ({primaryFocusAsset})</span>
            </div>
            <div style={s.btnGroup}>
              <button onClick={() => setActiveIndicator('RSI')} style={{...s.toggleBtn, color: activeIndicator === 'RSI' ? '#00ffcc' : '#444' }}>RSI</button>
              <button onClick={() => setActiveIndicator('MACD')} style={{...s.toggleBtn, color: activeIndicator === 'MACD' ? '#00ffcc' : '#444' }}>MACD</button>
            </div>
          </div>

          <div style={{ width: '100%', height: '80px' }}>
            {loading || indicatorData.length === 0 ? (
              <div style={s.miniLoader}>COMPUTING...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={indicatorData} margin={{ top: 2, right: 5, left: -25, bottom: 0 }}>
                  <CartesianGrid stroke="#0c0c0c" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" hide />
                  {activeIndicator === 'RSI' ? (
                    <>
                      <YAxis stroke="#222" style={{ fontSize: '7px', fontFamily: 'monospace' }} domain={[0, 100]} ticks={[30, 70]} />
                      <Tooltip contentStyle={{ background: '#050505', border: '1px solid #1a1a1a', color: '#fff', fontSize: '10px', fontFamily: 'monospace' }} />
                      <Line type="monotone" dataKey="RSI" name="RSI" stroke="#ffcc00" dot={false} strokeWidth={1} />
                    </>
                  ) : (
                    <>
                      <YAxis stroke="#222" style={{ fontSize: '7px', fontFamily: 'monospace' }} domain={['auto', 'auto']} tickFormatter={(t) => t.toExponential(0)} />
                      <Tooltip contentStyle={{ background: '#050505', border: '1px solid #1a1a1a', color: '#fff', fontSize: '10px', fontFamily: 'monospace' }} />
                      <Line type="monotone" dataKey="MACD" name="MACD" stroke="#00ffcc" dot={false} strokeWidth={1} />
                      <Line type="monotone" dataKey="Signal" name="Signal" stroke="#ff4444" strokeDasharray="2 2" dot={false} strokeWidth={1} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

const s = {
  masterContainer: { width: '100%', maxWidth: '1400px', margin: '0 auto', padding: '5px', boxSizing: 'border-box' },
  panel: { background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '16px', padding: '15px', display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box' },
  header: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '12px' },
  controlsRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  title: { margin: 0, fontSize: '11px', fontWeight: '900', letterSpacing: '0.5px', color: '#fff', fontFamily: 'sans-serif' },
  btnGroup: { display: 'flex', background: '#000', padding: '2px', borderRadius: '6px', border: '1px solid #161616' },
  toggleBtn: { border: 'none', background: 'transparent', padding: '3px 6px', fontSize: '8px', fontWeight: 'bold', cursor: 'pointer', outline: 'none', fontFamily: 'monospace' },
  tfBtn: { border: '1px solid transparent', padding: '3px 6px', fontSize: '8px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer', outline: 'none' },
  toggles: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' },
  pillBtn: { border: 'none', background: 'transparent', padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', borderRadius: '6px', cursor: 'pointer', outline: 'none', whiteSpace: 'nowrap' },
  focusBtn: { border: 'none', borderRadius: '4px', padding: '2px 5px', fontSize: '7px', fontWeight: '900', cursor: 'pointer', marginLeft: '2px', fontFamily: 'monospace' },
  chartContainer: { background: '#000', border: '1px solid #111', borderRadius: '12px', padding: '10px 5px 2px 5px', boxSizing: 'border-box' },
  indicatorSection: { marginTop: '10px', background: '#000', border: '1px solid #111', borderRadius: '12px', padding: '10px' },
  indicatorHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  indicatorTitle: { fontSize: '8px', fontWeight: 'bold', color: '#666', fontFamily: 'monospace' },
  loader: { color: '#00ffcc', fontSize: '9px', textAlign: 'center', padding: '100px 0', fontFamily: 'monospace' },
  miniLoader: { color: '#ffcc00', fontSize: '8px', textAlign: 'center', padding: '30px 0', fontFamily: 'monospace' }
};
