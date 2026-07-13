import React, { useEffect, useState } from 'react';
import axios from 'axios';
import BridgeWidget from '../components/BridgeWidget';
import KycModal from '../components/KycModal'; 

const Dashboard = ({ userAddress, isStandalone }) => {
  const [balances, setBalances] = useState([]);
  const [kycStatus, setKycStatus] = useState('TIER_0_UNVERIFIED');
  const [loading, setLoading] = useState(true);
  const [showKycModal, setShowKycModal] = useState(false); 

  const rawAddress = userAddress || localStorage.getItem('sovereign_local') || localStorage.getItem('seagull_user_id') || 'GUEST_MODE';
  const address = rawAddress; 

  const displayAddress = (rawAddress.length > 25 && rawAddress !== "GUEST_MODE")
    ? `${rawAddress.slice(0, 6)}...${rawAddress.slice(-4)}`
    : rawAddress; 

  const mnemonic = localStorage.getItem('secret') || localStorage.getItem('seagull_mnemonic'); 

  useEffect(() => {
    const fetchBalancesAndCompliance = async () => {
      if (!address || address === "GUEST_MODE") {
        setLoading(false);
        return;
      } 

      // 1. Immediately load any saved tier from local storage
      const savedKyc = localStorage.getItem(`kyc_status_${address}`);
      if (savedKyc) {
        setKycStatus(savedKyc);
      }

      try {
        // 🦅 Extract pre-derived native keys from local memory so backend doesn't guess
        const cachedXrpl = localStorage.getItem('cached_xrpl_address') || '';
        const cachedStellar = localStorage.getItem('cached_stellar_address') || ''; 

        // 🦅 Inject custom headers into the pulse payload request
        const resBalances = await axios.get(`/api/balances/${address}`, {
          headers: {
            'x-native-xrpl': cachedXrpl,
            'x-native-stellar': cachedStellar
          }
        });
        setBalances(resBalances.data); 

        const resProfile = await axios.get(`/api/agent/profile?id=${address}`);
        if (resProfile.data && resProfile.data.success) {
          // 2. Only update state from server if the server actually recognizes a verified tier
          if (resProfile.data.kycStatus !== 'TIER_0_UNVERIFIED') {
            setKycStatus(resProfile.data.kycStatus);
            localStorage.setItem(`kyc_status_${address}`, resProfile.data.kycStatus);
          }
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
                <span>CONNECTED: {displayAddress}</span>
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
                  >
                    ⚠️ TIER 0 UNVERIFIED (CLICK TO UPGRADE)
                  </span>
                )}
              </>
            )}
          </p>
        </div>
      </header> 

      <main className="max-w-7xl mx-auto flex flex-col items-center w-full">
        {loading && address !== "GUEST_MODE" ? (
          <div className="text-zinc-600 font-bold animate-pulse uppercase font-mono py-12">
            Scanning Assets...
          </div>
        ) : (
          <div className="w-full max-w-lg">
            <BridgeWidget
              userAddress={address}
              userMnemonic={mnemonic}
              balances={balances}
              userWallets={{
                evm: address,
                xrpl: localStorage.getItem('cached_xrpl_address'),
                xlm: localStorage.getItem('cached_stellar_address'),
                stellar: localStorage.getItem('cached_stellar_address')
              }}
              kycStatus={kycStatus}
            />
          </div>
        )}
      </main> 

      {showKycModal && (
        <KycModal
          seagullNetId={address}
          targetTier="TIER_2_INSTITUTIONAL"
          onVerificationSuccess={(registration) => {
            setKycStatus("TIER_2_INSTITUTIONAL");
            // 3. Save to local storage right when they finish
            localStorage.setItem(`kyc_status_${address}`, "TIER_2_INSTITUTIONAL");
            setShowKycModal(false);
          }}
          onClose={() => setShowKycModal(false)}
        />
      )}
    </div>
  );
}; 

export default Dashboard;
