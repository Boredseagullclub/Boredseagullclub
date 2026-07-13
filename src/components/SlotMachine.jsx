import React, { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import * as xrpl from 'xrpl';
import { Buffer } from 'buffer';

const SYMBOLS = ['🪽', '🌀', '🪙', '🎰', '🚀', '𝕏'];
const REEL_ANIMATION_TIME = 1500;

const SlotMachine = ({ userAddress }) => {
  const [selectedChain, setSelectedChain] = useState('XRPL');
  const [betAmount, setBetAmount] = useState('');
  const [multiplier, setMultiplier] = useState(1);
  const [reels, setReels] = useState(['🦅', '🦅', '🦅']);
  const [isSpinning, setIsSpinning] = useState(false);
  const [gameResult, setGameResult] = useState(null);
  const [jackpotPool, setJackpotPool] = useState('5,000,000');

  const totalWager = (parseFloat(betAmount) || 0) * multiplier;

  const handleSpin = async () => {
    if (isSpinning) return;
    if (!userAddress || userAddress === "GUEST_MODE") return alert("🪽 Connect your wallet to initialize session.");
    if (!betAmount || parseFloat(betAmount) <= 0) return alert("🪽 Define your stake.");

    setIsSpinning(true);
    setGameResult(null);

    const interval = setInterval(() => {
      setReels([
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
      ]);
    }, 70);

    try {
      const TREASURY_TARGETS = {
        XRPL: 'rVKvTekTiqygS9qB27MPmsoDLyuD8PksF',
        XDC: 'xdc3B51F488f729e5Cfa566990Fd7f069F364b6984D',
        FLARE: '0x6FeD6C7501Ac980548DAE096F022Ae3758E6DecC'
      };
      const targetTreasury = TREASURY_TARGETS[selectedChain];
      const gameMemo = `SLOT_WAGER_${Date.now()}`;
      const mnemonic = localStorage.getItem('secret') || localStorage.getItem('seagull_mnemonic');

      if (!mnemonic) throw new Error("Vault Locked: No secret found.");

      let liveTxHash = "";
      let activeSignerAddress = "";

      if (selectedChain === 'XRPL') {
        const xrplWallet = xrpl.Wallet.fromMnemonic(mnemonic);
        activeSignerAddress = xrplWallet.address; 

        const client = new xrpl.Client("wss://s2.ripple.com");
        await client.connect();
        
        const tx = {
          TransactionType: "Payment",
          Account: xrplWallet.address,
          Destination: targetTreasury,
          Amount: {
            currency: "53656167756C6C436F696E000000000000000000",
            issuer: "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno",
            value: totalWager.toString()
          },
          Memos: [{
            Memo: {
              MemoData: Buffer.from(gameMemo, 'utf8').toString('hex').toUpperCase(),
              MemoFormat: Buffer.from('text/plain', 'utf8').toString('hex').toUpperCase(),
              MemoType: Buffer.from('transaction-wager', 'utf8').toString('hex').toUpperCase()
            }
          }]
        };

        const prepared = await client.autofill(tx);
        const signed = xrplWallet.sign(prepared);
        const submitResult = await client.submitAndWait(signed.tx_blob);
        liveTxHash = submitResult.result.hash;
        await client.disconnect();
        
      } else if (['FLARE', 'FLR', 'XDC'].includes(selectedChain)) {
        const RPC_ENDPOINTS = {
          'XDC': ['https://erpc.xinfin.network', 'https://rpc.xinfin.network'],
          'FLARE': ['https://flare-api.flare.network/ext/C/rpc']
        };
        let provider = null;
        for (const url of RPC_ENDPOINTS[selectedChain]) {
          try {
            provider = new ethers.JsonRpcProvider(url);
            await provider.getNetwork();
            break;
          } catch (e) { continue; }
        }
        if (!provider) throw new Error("Network offline.");

        const evmWallet = ethers.Wallet.fromPhrase(mnemonic).connect(provider);
        activeSignerAddress = evmWallet.address; 

        const CONTRACTS = { 'XDC': '0xd38109F587bd0326CAd60a18CF3C1ECD546809a6', 'FLARE': '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f' };
        const contractAddress = CONTRACTS[selectedChain];
        const tokenContract = new ethers.Contract(contractAddress, ["function transfer(address to, uint256 amount) returns (bool)"], evmWallet);
        const amountWei = ethers.parseUnits(totalWager.toString(), 18);
        
        let cleanRecipient = targetTreasury;
        if (cleanRecipient.startsWith('xdc')) cleanRecipient = '0x' + cleanRecipient.slice(3);

        // --- EVM MEMO HACK & XDC GAS FIX ---
        const baseData = tokenContract.interface.encodeFunctionData("transfer", [cleanRecipient, amountWei]);
        const hexMemo = ethers.hexlify(ethers.toUtf8Bytes(gameMemo)).slice(2);
        const finalData = baseData + hexMemo; 
        
        const feeData = await provider.getFeeData();
        const txResponse = await evmWallet.sendTransaction({
            to: contractAddress,
            data: finalData,
            gasLimit: 150000n,
            gasPrice: feeData.gasPrice
        });
        
        await txResponse.wait(1);
        liveTxHash = txResponse.hash;
      }

      const gameResponse = await axios.post('https://seagull-xlm.xyz/api/games/slot-spin', {
        userId: activeSignerAddress,
        userWallet: activeSignerAddress,
        chain: selectedChain,
        amount: totalWager,
        txHash: liveTxHash
      });

      clearInterval(interval);
      if (gameResponse.data.success) {
        setReels(gameResponse.data.reels);
        setIsSpinning(false);
        setGameResult({ type: gameResponse.data.outcome, msg: gameResponse.data.message });
      }
    } catch (err) {
      clearInterval(interval);
      console.error("FLOW FAILURE:", err);
      alert(`Transaction aborted: ${err.message}`);
      setIsSpinning(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>🦅 SEAGULL NET SLOTS</h2>
        <p style={styles.subtitle}>NON-CUSTODIAL LIQUIDITY SINK</p>
      </div>
      <div style={styles.jackpotContainer}>
        <label style={styles.label}>COMMUNITY TREASURY POT</label>
        <div style={styles.jackpotVal}>🎰 {jackpotPool} SeagullCoin</div>
      </div>
      <div style={styles.slotRow}>
        {reels.map((symbol, idx) => (
          <div key={idx} style={{ ...styles.reelBox, borderColor: gameResult?.type === 'WIN' ? '#00ffcc' : '#111' }}>
            <span style={styles.symbolText}>{symbol}</span>
          </div>
        ))}
      </div>
      {gameResult && (
        <div style={{ ...styles.resultBanner, color: gameResult.type === 'LOSS' ? '#ff4444' : '#00ffcc', borderColor: gameResult.type === 'LOSS' ? '#ff4444' : '#00ffcc' }}>
          {gameResult.msg}
        </div>
      )}
      <div style={styles.controlBox}>
        <label style={styles.label}>SELECT SYSTEM ASSET</label>
        <select value={selectedChain} onChange={(e) => setSelectedChain(e.target.value)} style={styles.input} disabled={isSpinning}>
          <option value="XRPL" style={{ color: '#000' }}>SeagullCoin (XRPL)</option>
          <option value="XDC" style={{ color: '#000' }}>SeagullCoin (XDC Network)</option>
          <option value="FLARE" style={{ color: '#000' }}>SeagullCoin (Flare)</option>
        </select>
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <div style={{ flex: 2 }}>
            <label style={styles.label}>BASE WAGER AMOUNT</label>
            <input type="number" placeholder="0.00" value={betAmount} onChange={(e) => setBetAmount(e.target.value)} style={styles.input} disabled={isSpinning} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>MULTIPLIER</label>
            <div style={styles.multGroup}>
              {[1, 1.5, 3].map((m) => (
                <button key={m} onClick={() => setMultiplier(m)} style={{ ...styles.multBtn, background: multiplier === m ? '#00d4ff' : '#000', color: multiplier === m ? '#000' : '#666' }} disabled={isSpinning}>
                  {m}x
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={styles.riskBreakdown}>
          <span>TOTAL COMPOSITE RISK:</span>
          <span style={{ color: '#ffcc00' }}>{totalWager.toFixed(2)} SGC</span>
        </div>
        <button onClick={handleSpin} style={{ ...styles.spinButton, opacity: isSpinning ? 0.5 : 1, cursor: isSpinning ? 'not-allowed' : 'pointer' }} disabled={isSpinning}>
          {isSpinning ? 'SPINNING REELS...' : '⚡ TRIGGER SYSTEM SPIN'}
        </button>
      </div>
    </div>
  );
};

const styles = {
  container: { background: '#080808', border: '1px solid #1a1a1a', padding: '25px', borderRadius: '25px', color: '#fff', maxWidth: '420px', margin: 'auto' },
  header: { borderBottom: '1px solid #222', paddingBottom: '15px', marginBottom: '20px', textAlign: 'center' },
  title: { margin: 0, fontSize: '18px', fontWeight: '900', color: '#00d4ff', letterSpacing: '1px' },
  subtitle: { margin: '4px 0 0 0', fontSize: '8px', color: '#444', fontWeight: 'bold', letterSpacing: '2px' },
  jackpotContainer: { background: '#000', border: '1px dashed #ffcc00', borderRadius: '15px', padding: '12px', textAlign: 'center', marginBottom: '20px' },
  jackpotVal: { fontSize: '20px', fontWeight: '900', color: '#ffcc00', marginTop: '5px' },
  slotRow: { display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '25px' },
  reelBox: { width: '90px', height: '110px', background: '#000', border: '1px solid #111', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  symbolText: { fontSize: '42px' },
  controlBox: { display: 'flex', flexDirection: 'column', gap: '10px', background: '#020202', padding: '15px', borderRadius: '18px', border: '1px solid #111' },
  label: { fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' },
  input: { padding: '12px', background: '#000', color: '#fff', border: '1px solid #111', borderRadius: '10px', fontSize: '13px', width: '100%', boxSizing: 'border-box' },
  multGroup: { display: 'flex', gap: '4px' },
  multBtn: { flex: 1, padding: '11px 5px', border: '1px solid #111', borderRadius: '8px', fontSize: '10px', fontWeight: '900' },
  riskBreakdown: { display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.01)', border: '1px dashed #222', borderRadius: '8px' },
  spinButton: { width: '100%', padding: '15px', background: 'linear-gradient(45deg, #00d4ff, #00ffcc)', color: '#000', border: 'none', borderRadius: '12px', fontWeight: 'bold' },
  resultBanner: { border: '1px solid', padding: '12px', borderRadius: '12px', background: 'rgba(0,0,0,0.5)', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', marginBottom: '15px' }
};

export default SlotMachine;
