import React, { useState } from 'react';
import axios from 'axios';

const Swap = ({ userAddress }) => {
  const [fromAsset, setFromAsset] = useState('XRP');
  const [toAsset, setToAsset] = useState('XDC');
  const [amount, setAmount] = useState('');
  const [swapping, setSwapping] = useState(false);
  const [status, setStatus] = useState('');

  const handleSwap = async (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return alert("Enter a valid amount");
    if (fromAsset === toAsset) return alert("Assets must be different");

    setSwapping(true);
    setStatus('Routing cross-chain path...');

    try {
      const response = await axios.post('/api/swap', {
        address: userAddress,
        from: fromAsset,
        to: toAsset,
        amount: parseFloat(amount)
      });

      if (response.data.success) {
        setStatus(`Swap Complete! Tx: ${response.data.txHash || 'Settled'}`);
      } else {
        setStatus(`Aborted: ${response.data.message || 'Verification failed'}`);
      }
    } catch (err) {
      console.error(err);
      setStatus('Settlement failure. Check balance guards.');
    } finally {
      setSwapping(false);
    }
  };

  return (
    <div style={{ background: '#050505', border: '1px solid #1a1a1a', padding: '20px', borderRadius: '12px', color: '#fff', maxWidth: '400px', margin: '20px auto' }}>
      <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', letterSpacing: '1px', color: '#00d4ff', fontFamily: 'monospace' }}>⚡ LIQUIDITY_SWAP_CORE</h3>
      <form onSubmit={handleSwap} style={{ display: 'flex', flexType: 'column', flexDirection: 'column', gap: '15px' }}>
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '5px' }}>FROM ASSET</label>
          <select value={fromAsset} onChange={(e) => setFromAsset(e.target.value)} style={{ width: '100%', padding: '10px', background: '#000', color: '#fff', border: '1px solid #222', borderRadius: '6px' }}>
            <option value="XRP">XRP (XRPL)</option>
            <option value="XDC">XDC (XDC Network)</option>
            <option value="FLR">FLR (Flare)</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '5px' }}>TO ASSET</label>
          <select value={toAsset} onChange={(e) => setToAsset(e.target.value)} style={{ width: '100%', padding: '10px', background: '#000', color: '#fff', border: '1px solid #222', borderRadius: '6px' }}>
            <option value="XDC">XDC (XDC Network)</option>
            <option value="XRP">XRP (XRPL)</option>
            <option value="FLR">FLR (Flare)</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '5px' }}>AMOUNT</label>
          <input type="number" step="any" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: '100%', padding: '10px', background: '#000', color: '#fff', border: '1px solid #222', borderRadius: '6px', boxSizing: 'border-box' }} />
        </div>
        <button type="submit" disabled={swapping} style={{ width: '100%', padding: '12px', background: 'linear-gradient(90deg, #00d4ff, #0095ff)', border: 'none', borderRadius: '6px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>
          {swapping ? 'EXECUTING SETTLEMENT...' : 'EXECUTE PROTOCOL SWAP'}
        </button>
        {status && <div style={{ fontSize: '11px', color: '#ffcc00', marginTop: '5px', textAlign: 'center', fontFamily: 'monospace' }}>{status}</div>}
      </form>
    </div>
  );
};

export default Swap;
