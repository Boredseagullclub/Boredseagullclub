import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import NFTGallery from './NFTGallery';

const NFTUtility = ({ userAddress }) => {
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUtility = useCallback(async () => {
    // 🦅 Stop early if it's a guest session or invalid address string
    if (!userAddress || typeof userAddress !== 'string' || userAddress === 'GUEST_MODE') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await axios.get(`/api/nft-utility/check/${userAddress}`);
      if (response.data?.success) {
        setHoldings(response.data.holdings || []);
      } else {
        throw new Error('Invalid response structure');
      }
    } catch (err) {
      console.error("NFT Utility Fetch Error:", err);
      setError("Unable to sync assets with the ledger.");
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchUtility();
  }, [fetchUtility]);

  // Master style adjustments to match your theme
  const wrapperStyle = {
    width: '100%',
    maxWidth: '600px',
    background: '#0a0a0a',
    border: '1px solid #1a1a1a',
    padding: '30px',
    borderRadius: '24px',
    boxSizing: 'border-box',
    color: '#fff',
    fontFamily: 'sans-serif'
  };

  // 🏛️ HANDLE GUEST / DISCONNECTED STATE EXPLICITLY (No more invisible blank screen!)
  if (!userAddress || userAddress === 'GUEST_MODE') {
    return (
      <div style={wrapperStyle}>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <span style={{ fontSize: '32px', display: 'block', marginBottom: '15px' }}>🔒</span>
          <h2 style={{ fontSize: '18px', fontWeight: '900', color: '#00d4ff', margin: '0 0 10px 0' }}>VAULT DISCONNECTED</h2>
          <p style={{ fontSize: '12px', color: '#666', margin: 0, lineHeight: '1.6' }}>
            Please return to the main interface and unlock your sovereign wallet identity to access your multi-chain assets.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={wrapperStyle}>
        <div style={{ color: '#444', fontSize: '13px', textAlign: 'center', padding: '40px 0' }}>
          Scanning ledger for secure assets...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...wrapperStyle, borderColor: 'rgba(255, 68, 68, 0.2)' }}>
        <div style={{ color: '#ff4444', fontSize: '13px', textAlign: 'center' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '900', letterSpacing: '1px', margin: 0 }}>SEAGULL UTILITY</h2>
        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#444' }}>{holdings.length} Assets Found</span>
      </div>

      {holdings.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', borderTop: '1px solid #111' }}>
          <p style={{ fontSize: '13px', color: '#444', margin: 0 }}>No eligible assets detected in this wallet address.</p>
        </div>
      ) : (
        <NFTGallery
            holdings={holdings}
            onClaim={(id) => console.log(`Claiming: ${id}`)}
        />
      )}
    </div>
  );
};

export default NFTUtility;
