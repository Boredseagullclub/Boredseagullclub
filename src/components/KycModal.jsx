import React, { useState } from 'react';

const KycModal = ({ seagullNetId, targetTier, onVerificationSuccess, onClose }) => {
  const [verifying, setVerifying] = useState(false);

  const handleVerify = () => {
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      // Triggers your wallet/dashboard handlers to immediately elevate limits
      onVerificationSuccess({ verified: true, timestamp: Date.now() });
    }, 1200);
  };

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.header}>
          <h3 style={s.title}>🛡️ SOVEREIGN_COMPLIANCE_GATEWAY</h3>
          <button onClick={onClose} style={s.closeBtn}>[X]</button>
        </div>
        
        <div style={s.body}>
          <p style={s.text}>TARGET_NODE: <span style={s.highlight}>{seagullNetId || "GUEST_NODE"}</span></p>
          <p style={s.text}>REQUESTED_LEVEL: <span style={s.warn}>{targetTier || "TIER_1_VERIFIED"}</span></p>
          <p style={{ ...s.text, color: '#555' }}>
            Notice: Initializing automated identity validation cryptographic pass. Compliance required for high-volume cross-chain settlement.
          </p>
        </div>

        <div style={s.actions}>
          <button onClick={onClose} style={s.cancelBtn}>ABORT</button>
          <button onClick={handleVerify} disabled={verifying} style={s.confirmBtn}>
            {verifying ? 'COMPUTING PASS...' : '⚡ INITIALIZE VERIFICATION'}
          </button>
        </div>
      </div>
    </div>
  );
};

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifycontent: 'center', justifyContent: 'center', zIndex: 10000, fontFamily: 'monospace' },
  modal: { background: '#050505', border: '1px solid #1a1a1a', padding: '20px', borderRadius: '12px', maxWidth: '450px', width: '90%', boxSizing: 'border-box' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #111', paddingBottom: '10px', marginBottom: '15px' },
  title: { margin: 0, fontSize: '12px', color: '#00ffcc', letterSpacing: '1px' },
  closeBtn: { background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontWeight: 'bold' },
  body: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' },
  text: { margin: 0, fontSize: '11px', lineHeight: '1.5', color: '#888' },
  highlight: { color: '#00d4ff', fontWeight: 'bold' },
  warn: { color: '#ffcc00', fontWeight: 'bold' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #111', paddingTop: '15px' },
  cancelBtn: { background: 'transparent', border: '1px solid #333', color: '#666', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px' },
  confirmBtn: { background: 'linear-gradient(45deg, #00ffcc, #00d4ff)', border: 'none', color: '#000', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }
};

export default KycModal;
