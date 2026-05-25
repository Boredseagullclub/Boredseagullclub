import React, { useState, useEffect } from 'react';
import axios from 'axios';
import KycModal from './KycModal';


const AgentGateway = ({ userAddress, mnemonic }) => {
  const [protocolStatus, setStatus] = useState('ACTIVE');
  const [recentLogs, setRecentLogs] = useState([]);

  // 🛡️ Upgraded Compliance & Multi-Asset Identity State
  const [kycStatus, setKycStatus] = useState('TIER_0_UNVERIFIED');
  const [dailyLimitSeagullCoin, setDailyLimitSeagullCoin] = useState(10000);       
  const [dailyLimitSeagullCash, setDailyLimitSeagullCash] = useState(1000000);   
  const [showKycModal, setShowKycModal] = useState(false);
  const [seagullNetId, setSeagullNetId] = useState('SGN-ID-5023');

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await axios.get('/api/iso-terminal');
        setRecentLogs(Array.isArray(res.data) ? res.data.slice(0, 5) : []);
      } catch (err) {
        console.error("Archive sync failed");
      }
    };

    const fetchAgentProfile = async () => {
      try {
        const res = await axios.get(`/api/agent/profile?id=${seagullNetId}`);
        if (res.data && res.data.success) {
          setKycStatus(res.data.kycStatus || 'TIER_0_UNVERIFIED');
          setDailyLimitSeagullCoin(res.data.dailyLimitSeagullCoin || 10000);
          setDailyLimitSeagullCash(res.data.dailyLimitSeagullCash || 1000000);
        }
      } catch (err) {
        console.error("Profile sync failed, using default limits.");
      }
    };

    fetchActivity();
    fetchAgentProfile();
    const interval = setInterval(fetchActivity, 5000);
    return () => clearInterval(interval);
  }, [seagullNetId]);

  const handleKycSuccess = (registration) => {
    setKycStatus("TIER_1_VERIFIED");
    setDailyLimitSeagullCoin(500000);
    setDailyLimitSeagullCash(1000000000);
    setShowKycModal(false);
  };

  return (
    <div style={gatewayBg}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={gearWrapper}>⚙️</div>
            <div>
              <h1 style={agentTitle}>SEAGULL_SOVEREIGN_GATEWAY_v2.0</h1>
              <p style={statusLabel}>
                AUTONOMOUS_AGENTS: <span style={pulseText}>{protocolStatus}</span>
              </p>
            </div>
          </div>

          <div style={identityHeaderStyle}>
            <div style={{ textAlign: 'right', marginRight: '15px' }}>
              <p style={identityLabel}>ID: <span style={highlightText}>{seagullNetId}</span></p>
              <p style={identityLabel}>SGC_LIMIT: <span style={limitSgc}>{dailyLimitSeagullCoin.toLocaleString()} SGC/DAY</span></p>
              <p style={identityLabel}>CASH_LIMIT: <span style={limitSgcash}>{dailyLimitSeagullCash.toLocaleString()} SGCASH/DAY</span></p>
            </div>
            {kycStatus === 'TIER_0_UNVERIFIED' ? (
              <button style={upgradeBtnStyle} onClick={() => setShowKycModal(true)}>
                [UPGRADE_COMPLIANCE]
              </button>
            ) : (
              <span style={verifiedBadgeStyle}>👑 VERIFIED_TIER_1</span>
            )}
          </div>
        </div>
      </div>

      <div style={mainLayout}>
        <div style={{ ...cardStyle, borderColor: '#00d4ff33' }}>
          <h3 style={cardTitle}>LIVE_ISO_20022_MESSAGING_STREAM</h3>
          <div style={logContainer}>
            {recentLogs.length > 0 ? recentLogs.map((log, i) => (
              <div key={i} style={logEntry}>
                <span style={{color: '#888'}}>[{new Date().toLocaleTimeString()}]</span>
                <span style={{color: '#00ffcc'}}> pacs.008_ARCHIVED:</span> {log.hash || log._id || "TX_ID_MASKED"}
              </div>
            )) : <div style={logEntry}>SCANNING_FOR_NETWORK_ACTIVITY...</div>}
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={cardTitle}>FINANCIAL_MESSAGING_SCHEMA</h3>
          <code style={codeBlock}>
            {`Type: pacs.008.001.08\nCompliance: ISO-20022\nRequired_Fields: [MsgId, CreDtTm, IntrBkSttlmAmt, Dbtr, Cdtr]`}
          </code>
        </div>
      </div>

      <div style={footerStyle}>
        <p>REACTION_SOLUTION_ACTIVE // NO_HUMAN_INTERVENTION_REQUIRED</p>
      </div>

      {showKycModal && (
        <KycModal
          seagullNetId={seagullNetId}
          onVerificationSuccess={handleKycSuccess}
          onClose={() => setShowKycModal(false)}
        />
      )}
    </div>
  );
};

const gatewayBg = { minHeight: '100vh', background: '#000', color: '#00ffcc', fontFamily: 'monospace', padding: '40px' };
const headerStyle = { marginBottom: '40px', borderBottom: '1px solid #1a1a1a', paddingBottom: '20px', display: 'flex' };
const agentTitle = { fontSize: '20px', fontWeight: 'bold', letterSpacing: '2px', margin: 0 };
const statusLabel = { fontSize: '11px', color: '#666', margin: '5px 0 0 0' };
const pulseText = { color: '#00ffcc', textShadow: '0 0 10px #00ffcc' };
const mainLayout = { display: 'flex', flexDirection: 'column', gap: '20px' };
const cardStyle = { background: '#050505', border: '1px solid #1a1a1a', padding: '20px', borderRadius: '5px' };
const cardTitle = { fontSize: '12px', color: '#888', marginBottom: '15px', letterSpacing: '1px' };
const logContainer = { background: '#020202', padding: '15px', borderRadius: '4px', border: '1px solid #111', height: '120px', overflowY: 'auto' };
const logEntry = { fontSize: '10px', fontFamily: 'monospace', marginBottom: '8px', borderLeft: '2px solid #00d4ff', paddingLeft: '10px' };
const codeBlock = { display: 'block', whiteSpace: 'pre', fontSize: '12px', color: '#00d4ff', lineHeight: '1.6' };
const gearWrapper = { fontSize: '30px' };
const footerStyle = { marginTop: '50px', paddingTop: '20px', borderTop: '1px solid #1a1a1a', color: '#333', fontSize: '10px' };
const identityHeaderStyle = { display: 'flex', alignItems: 'center', gap: '20px', fontFamily: 'monospace' };
const identityLabel = { margin: '2px 0', fontSize: '11px', color: '#666', letterSpacing: '1px' };
const highlightText = { color: '#00d4ff', fontWeight: 'bold' };
const limitSgc = { color: '#ffcc00', fontWeight: 'bold' };
const limitSgcash = { color: '#00ffcc', fontWeight: 'bold' };
const upgradeBtnStyle = { background: 'transparent', border: '1px solid #ffcc00', color: '#ffcc00', padding: '8px 15px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer', letterSpacing: '1px', transition: 'all 0.2s ease' };
const verifiedBadgeStyle = { border: '1px solid #00ffcc', color: '#00ffcc', padding: '8px 15px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px' };

export default AgentGateway;
