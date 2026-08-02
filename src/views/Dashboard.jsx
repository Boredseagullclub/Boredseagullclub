import React, { useEffect, useState } from 'react';
import axios from 'axios';
import BridgeWidget from '../components/BridgeWidget';
import KycModal from '../components/KycModal';
import NFTUtility from '../components/NFTUtility';

const Dashboard = ({ userAddress, isStandalone }) => {
  const [balances, setBalances] = useState([]);
  const [kycStatus, setKycStatus] = useState('TIER_0_UNVERIFIED');
  const [loading, setLoading] = useState(true);
  const [showKycModal, setShowKycModal] = useState(false);

  // 1. Strict isolation: Read sovereign_local ONLY. 
  // If it's "Unknown Vault" or missing, it evaluates to empty string instead of pulling a cross-chain ID.
  const storedEvm = localStorage.getItem('sovereign_local');
  const cleanEvmAddress = (storedEvm && storedEvm !== 'Unknown Vault') ? storedEvm : (userAddress || '');

  // 2. Network-specific caches kept entirely separate
  const cachedXrpl = localStorage.getItem('cached_xrpl_address') || '';
  const cachedStellar = localStorage.getItem('cached_stellar_address') || '';

  const displayAddress = (storedEvm === 'Unknown Vault') 
    ? 'Unknown Vault' 
    : (cleanEvmAddress.length > 25 ? `${cleanEvmAddress.slice(0, 6)}...${cleanEvmAddress.slice(-4)}` : (cleanEvmAddress || 'GUEST_MODE'));

  const mnemonic = localStorage.getItem('secret') || localStorage.getItem('seagull_mnemonic');

  useEffect(() => {
    const fetchBalancesAndCompliance = async () => {
      if (!cleanEvmAddress) {
        setLoading(false);
        return;
      }

      const savedKyc = localStorage.getItem(`kyc_status_${cleanEvmAddress}`);
      if (savedKyc) {
        setKycStatus(savedKyc);
      }

      try {
        const resBalances = await axios.get(`/api/balances/${cleanEvmAddress}`, {
          headers: {
            'x-native-xrpl': cachedXrpl,
            'x-native-stellar': cachedStellar
          }
        });
        setBalances(resBalances.data);

        const resProfile = await axios.get(`/api/user/profile?id=${cleanEvmAddress}`);
        if (resProfile.data && resProfile.data.success) {
          if (resProfile.data.kycStatus !== 'TIER_0_UNVERIFIED') {
            setKycStatus(resProfile.data.kycStatus);
            localStorage.setItem(`kyc_status_${cleanEvmAddress}`, resProfile.data.kycStatus);
          }
        }
      } catch (err) {
        console.error("Pulse Failed:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchBalancesAndCompliance();
  }, [cleanEvmAddress, cachedXrpl, cachedStellar]);

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12">
      <header className="max-w-7xl mx-auto mb-12 flex flex-col md:flex-row justify-between items-start md:items-center">
        <div>
          <h1 className="text-4xl font-black tracking-tighter italic" style={{ color: '#ffffff' }}>SEAGULL <span className="text-blue-600">WALLET</span></h1>
          <p className="text-zinc-500 font-mono text-xs mt-1" style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#71717a' }}>
            {!cleanEvmAddress && storedEvm !== 'Unknown Vault' ? (
              "PUBLIC ACCESS NODE"
            ) : (
              <>
                <span style={{ color: '#24e0a5', whiteSpace: 'nowrap' }}>CONNECTED: {displayAddress}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {kycStatus === 'TIER_1_VERIFIED' ? (
                    <span style={{ color: '#00ffcc', border: '1px solid #00ffcc', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                      👑 TIER 1 VERIFIED
                    </span>
                  ) : kycStatus === 'TIER_2_INSTITUTIONAL' ? (
                    <span style={{ color: '#ffcc00', border: '1px solid #ffcc00', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                      👥 TIER 2 PUBLIC
                    </span>
                  ) : (
                    <span
                      onClick={() => setShowKycModal(true)}
                      style={{
                        color: '#ff3333',
                        border: '1px solid #ff3333',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        background: 'rgba(255, 51, 83, 0.1)'
                      }}
                    >
                      ⚠️ TIER 0 UNVERIFIED (CLICK TO UPGRADE)
                    </span>
                  )}
                </span>
              </>
            )}
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto flex flex-col items-center w-full">
        {loading && cleanEvmAddress ? (
          <div className="text-zinc-600 font-bold animate-pulse uppercase font-mono py-12">
            Scanning Assets...
          </div>
        ) : (
          <div className="w-full max-w-lg">
            <BridgeWidget
              userAddress={cleanEvmAddress}
              userMnemonic={mnemonic}
              balances={balances}
              userWallets={{
                evm: cleanEvmAddress,
                xrpl: cachedXrpl,
                xlm: cachedStellar,
                stellar: cachedStellar
              }}
              kycStatus={kycStatus}
            />
          </div>
        )}
      </main>

      {showKycModal && (
        <KycModal
          seagullNetId={cleanEvmAddress}
          targetTier="TIER_2_INSTITUTIONAL"
          onVerificationSuccess={(registration) => {
            setKycStatus("TIER_2_INSTITUTIONAL");
            localStorage.setItem(`kyc_status_${cleanEvmAddress}`, "TIER_2_INSTITUTIONAL");
            setShowKycModal(false);
          }}
          onClose={() => setShowKycModal(false)}
        />
      )}
    </div>
  );
};

export default Dashboard;
