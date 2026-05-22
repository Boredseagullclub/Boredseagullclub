import React, { useState, useEffect } from 'react';
import axios from 'axios';

const BridgeWidget = ({ userAddress }) => {
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [txDetails, setTxDetails] = useState({
    fromChain: 'XDC',
    toChain: 'STELLAR',
    asset: 'SGC',
    amount: '',
    destinationAddress: ''
  });

  // 1. HIT THE RADAR: Get those balances on load
  useEffect(() => {
    const fetchRadar = async () => {
      try {
        const res = await axios.get(`/api/balances/${userAddress}`);
        setBalances(res.data);
      } catch (err) {
        console.error("Radar failed to scan.");
      }
    };
    if (userAddress) fetchRadar();
  }, [userAddress]);

  const handleBridgeBAM = async () => {
    setLoading(true);
    try {
      // 2. TRIGGER THE BRIDGE: Hits your bridgeRoutes.js
      const response = await axios.post('/api/bridge/execute', {
        ...txDetails,
        sender: userAddress
      });
      
      alert(`BAM! Bridge Initiated. Tx: ${response.data.txHash}`);
    } catch (err) {
      alert(`Bridge Failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bridge-container">
      <h2>Seagull Cross-Chain Bridge</h2>
      
      {/* Balance Display from Radar */}
      <div className="balance-strip">
        {balances.map((b, i) => (
          <div key={i} className="asset-card">
            <img src={b.logo} alt={b.symbol} width="20" />
            <span>{b.symbol}: {b.balance}</span>
          </div>
        ))}
      </div>

      <div className="input-group">
        <label>Destination Chain</label>
        <select onChange={(e) => setTxDetails({...txDetails, toChain: e.target.value})}>
          <option value="STELLAR">Stellar (SeagullCash)</option>
          <option value="XRPL">XRPL (SeagullCoin)</option>
          <option value="XDC">XDC Network</option>
          <option value="FLARE">Flare Network</option>
        </select>

        <label>Amount</label>
        <input 
          type="number" 
          placeholder="0.00"
          onChange={(e) => setTxDetails({...txDetails, amount: e.target.value})} 
        />

        <label>Destination Address</label>
        <input 
          type="text" 
          placeholder="Paste destination address"
          onChange={(e) => setTxDetails({...txDetails, destinationAddress: e.target.value})} 
        />
      </div>

      <button 
        className="bam-button"
        onClick={handleBridgeBAM}
        disabled={loading || !txDetails.amount || !txDetails.destinationAddress}
      >
        {loading ? 'Processing...' : 'BAM! BRIDGE NOW'}
      </button>
    </div>
  );
};

export default BridgeWidget;

