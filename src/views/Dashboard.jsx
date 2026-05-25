import React, { useEffect, useState } from 'react';
import axios from 'axios';
import BridgeWidget from '../components/BridgeWidget';
import KycModal from '../components/KycModal';


const Dashboard = ({ userAddress, isStandalone }) => { // 🦅 Pulling props from App.jsx
  const [balances, setBalances] = useState([]);
  const [kycStatus, setKycStatus] = useState('TIER_0_UNVERIFIED'); // 🦅 Added missing state tracker
  const [loading, setLoading] = useState(true);
  const [showKycModal, setShowKycModal] = useState(false);
  
    // 🦅 PATH PRIORITY: Use the prop if passed, fallback to standard local storage keys
  const rawAddress = userAddress || localStorage.getItem('sovereign_local') || localStorage.getItem('seagull_user_id') || 'GUEST_MODE';
  
  // Format long public hashes beautifully for your mobile layout views
  const address = (rawAddress.length > 25 && rawAddress !== "GUEST_MODE")
    ? `${rawAddress.slice(0, 6)}...${rawAddress.slice(-4)}`
    : rawAddress;

  const mnemonic = localStorage.getItem('secret') || localStorage.getItem('seagull_mnemonic');


  useEffect(() => {
    const fetchBalancesAndCompliance = async () => {
      // 🦅 GUEST BYPASS: Don't call the API if it's a guest
      if (!address || address === "GUEST_MODE") {
        setLoading(false);
        return;
      } 

      try {
        // 1. Fetch Balances
        const resBalances = await axios.get(`/api/balances/${address}`);
        setBalances(resBalances.data); 

        // 2. Fetch compliance tier data directly from the dynamic profile status API
        const resProfile = await axios.get(`/api/agent/profile?id=${address}`);
        if (resProfile.data && resProfile.data.success) {
          setKycStatus(resProfile.data.kycStatus);
        }
      } catch (err) {
        console.error("Pulse Failed:", err);
      } finally {
        setLoading(false);
      }
    }; 

    fetchBalancesAndCompliance();
  }, [address]); 

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12">
      <header className="max-w-7xl mx-auto mb-12 flex flex-col md:flex-row justify-between items-start md:items-center">
        <div>
          <h1 className="text-4xl font-black tracking-tighter italic">SEAGULL <span className="text-blue-600">DASHBOARD</span></h1>
          <p className="text-zinc-500 font-mono text-xs mt-1" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {address === "GUEST_MODE" ? (
              "PUBLIC ACCESS NODE"
            ) : (
              <>
                <span>CONNECTED: {address}</span>
                {/* 🛡️ DYNAMIC COMPLIANCE TIER BADGES */}
                {kycStatus === 'TIER_1_VERIFIED' ? (
                  <span style={{ color: '#00ffcc', border: '1px solid #00ffcc', padding: '1px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                    👑 TIER 1 VERIFIED
                  </span>
                ) : kycStatus === 'TIER_2_INSTITUTIONAL' ? (
                  <span style={{ color: '#ffcc00', border: '1px solid #ffcc00', padding: '1px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                    👥 TIER 2 PUBLIC
                  </span>
                ) : (
                  <span
                    onClick={() => setShowKycModal(true)}
                    style={{
                      color: '#ff3333',
                      border: '1px solid #ff3333',
                      padding: '1px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      background: 'rgba(255, 51, 83, 0.05)'
                    }}
                    title="Click to upgrade your compliance tier"
                  >
                    ⚠️ TIER 0 UNVERIFIED (CLICK TO UPGRADE)
                  </span>
                )}
              </>
            )}
          </p> 
        </div>
      </header> 

      <main className="max-w-7xl mx-auto flex flex-col items-center">
        {/* 🦅 THE GATE FIX: Don't show loading if it's a Guest */}
        {loading && address !== "GUEST_MODE" ? (
          <div className="text-zinc-600 font-bold animate-pulse uppercase font-mono">Scanning Assets...</div>
        ) : (
          <div className="w-full max-w-lg">
            <BridgeWidget
              userAddress={address}
              userMnemonic={mnemonic}
              balances={balances}
              userWallets={balances}
              kycStatus={kycStatus}
            />
          </div>
        )}
      </main>

      {/* Render the KYC verification modal dynamically */}
      {showKycModal && (
        <KycModal
          seagullNetId={address}
          targetTier="TIER_2_INSTITUTIONAL"
          onVerificationSuccess={(registration) => {
            setKycStatus("TIER_2_INSTITUTIONAL");
            setShowKycModal(false);
          }}
          onClose={() => setShowKycModal(false)}
        />
      )}
    </div>
  );
}; 

export default Dashboard;
