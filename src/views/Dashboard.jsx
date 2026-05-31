import React, { useEffect, useState } from 'react';
import axios from 'axios';
import BridgeWidget from '../components/BridgeWidget';
import KycModal from '../components/KycModal';

const Dashboard = ({ userAddress, isStandalone }) => {
  const [balances, setBalances] = useState([]);
  const [kycStatus, setKycStatus] = useState('TIER_0_UNVERIFIED');
  const [loading, setLoading] = useState(true);
  const [showKycModal, setShowKycModal] = useState(false);

  // 🦅 Grab the raw profile session indicator straight from local storage
  const rawAddress = userAddress || localStorage.getItem('sovereign_local') || localStorage.getItem('seagull_user_id') || 'GUEST_MODE';

  // 🦅 CLEAN LINKAGE: Fallback rows are now safe because we let rawAddress flow dynamically.
  // We read the address directly. No tracking loops overriding different user logins.
  const address = rawAddress;

  // Format header representation safely based on the resolved address variable
  const displayAddress = (address.length > 25 && address !== "GUEST_MODE")
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;

  const mnemonic = localStorage.getItem('secret') || localStorage.getItem('seagull_mnemonic');

  useEffect(() => {
    const fetchBalancesAndCompliance = async () => {
      if (!rawAddress || rawAddress === "GUEST_MODE") {
        setLoading(false);
        return;
      }

      try {
        const cachedXrpl = localStorage.getItem('cached_xrpl_address') || '';
        const cachedStellar = localStorage.getItem('cached_stellar_address') || '';
        const cachedHedera = localStorage.getItem('cached_hedera_id') || ''; // 🦅 Pulled Hedera into the pipeline

        // 🦅 Always query using rawAddress so the backend backstop catch block can process 'sovereign_user'
        const resBalances = await axios.get(`/api/balances/${rawAddress}`, {
          headers: {
            'x-native-xrpl': cachedXrpl,
            'x-native-stellar': cachedStellar,
            'x-native-hedera': cachedHedera // 🦅 Passing Hedera straight to the backend
          }
        });
        setBalances(resBalances.data);

        const resProfile = await axios.get(`/api/agent/profile?id=${rawAddress}`);
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
  }, [rawAddress]);

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
        {loading && address === "sovereign_user" ? (
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
                xrpl: localStorage.getItem('cached_xrpl_address') || balances.find(b => b.chain === 'XRPL')?.address || '',
                xlm: localStorage.getItem('cached_stellar_address') || balances.find(b => b.chain === 'XLM')?.address || '',
                stellar: localStorage.getItem('cached_stellar_address') || balances.find(b => b.chain === 'XLM')?.address || '',
                hedera: localStorage.getItem('cached_hedera_id') || balances.find(b => b.chain === 'HBAR')?.address || '' // 🦅 Explicit Hedera binding for the widget
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
            setShowKycModal(false);
          }}
          onClose={() => setShowKycModal(false)}
        />
      )}
    </div>
  );
};

export default Dashboard;
