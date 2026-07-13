import React, { useState, useEffect } from 'react';
import axios from 'axios';
import KycModal from './KycModal';

const AgentGateway = ({ userAddress, mnemonic }) => {
  const [viewMode, setViewMode] = useState('AGENT'); // Added view toggle
  const [protocolStatus, setStatus] = useState('ACTIVE');
  const [recentLogs, setRecentLogs] = useState([]);
  const [kycStatus, setKycStatus] = useState('TIER_0_UNVERIFIED');
  const [dailyLimitSeagullCoin, setDailyLimitSeagullCoin] = useState(10000);
  const [dailyLimitSeagullCash, setDailyLimitSeagullCash] = useState(1000000);
  const [showKycModal, setShowKycModal] = useState(false);
  const [seagullNetId] = useState('SGN-ID-5023');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [activity, profile] = await Promise.all([
          axios.get('/api/iso-terminal'),
          axios.get(`/api/agent/profile?id=${seagullNetId}`)
        ]);
        setRecentLogs(Array.isArray(activity.data) ? activity.data.slice(0, 5) : []);
        if (profile.data?.success) {
          setKycStatus(profile.data.kycStatus);
          setDailyLimitSeagullCoin(profile.data.dailyLimitSeagullCoin);
          setDailyLimitSeagullCash(profile.data.dailyLimitSeagullCash);
        }
      } catch (err) { console.error("Sync failed"); }
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [seagullNetId]);

  return (
    <div style={styles.gatewayBg}>
      <div style={styles.headerStyle}>
        <div>
          <h1 style={styles.agentTitle}>SEAGULL_SOVEREIGN_GATEWAY</h1>
          <p style={styles.statusLabel}>MODE: 
            <button onClick={() => setViewMode(v => v === 'AGENT' ? 'HUMAN' : 'AGENT')} style={styles.toggleBtn}>
              {viewMode}
            </button>
          </p>
        </div>
      </div>

      <div style={styles.mainLayout}>
        {viewMode === 'AGENT' ? (
          <div style={styles.cardStyle}>
            <h3 style={styles.cardTitle}>LIVE_ISO_20022_MESSAGING_STREAM</h3>
            <div style={styles.logContainer}>
              {recentLogs.map((log, i) => (
                <div key={i} style={styles.logEntry}>[{new Date().toLocaleTimeString()}] {log.hash}</div>
              ))}
            </div>
          </div>
        ) : (
          <div style={styles.cardStyle}>
            <h3>Account Overview</h3>
            <p>Verification: {kycStatus}</p>
            <p>Daily SGC Limit: {dailyLimitSeagullCoin.toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  gatewayBg: { minHeight: '100vh', background: '#000', color: '#00ffcc', padding: 'clamp(15px, 5vw, 40px)', fontFamily: 'monospace' },
  headerStyle: { borderBottom: '1px solid #1a1a1a', paddingBottom: '20px' },
  agentTitle: { fontSize: 'clamp(1rem, 4vw, 1.5rem)', margin: 0 },
  toggleBtn: { background: 'none', border: '1px solid #00ffcc', color: '#00ffcc', marginLeft: '10px', cursor: 'pointer' },
  mainLayout: { display: 'flex', flexDirection: 'column', gap: '20px' },
  cardStyle: { background: '#050505', border: '1px solid #1a1a1a', padding: '20px', borderRadius: '5px' },
  logContainer: { background: '#020202', padding: '10px', height: '120px', overflowY: 'auto', fontSize: '10px' },
  logEntry: { marginBottom: '8px', borderLeft: '2px solid #00d4ff', paddingLeft: '10px' },
  statusLabel: { fontSize: '11px', color: '#666', marginTop: '10px' }
};

export default AgentGateway;
