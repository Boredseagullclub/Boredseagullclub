
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import * as xrpl from 'xrpl';
import { Buffer } from 'buffer';

const SYMBOLS = ['🪽', '🌀', '🪙', '🎰', '🚀', '𝕏'];
const REEL_ANIMATION_TIME = 1500;

// Explorer utility for clickable transaction verification
const getExplorerLink = (chain, hash) => {
  if (chain === 'XRPL') return `https://livenet.xrpl.org/transactions/${hash}`;
  if (chain === 'XDC') return `https://xdcscan.com/tx/${hash}`;
  if (chain === 'FLARE') return `https://flare-explorer.flare.network/tx/${hash}`;
  return null;
};

const SlotMachine = ({ userAddress }) => {
  const [selectedChain, setSelectedChain] = useState('XRPL');
  const [betAmount, setBetAmount] = useState('');
  const [multiplier, setMultiplier] = useState(1);
  const [reels, setReels] = useState(['🪽', '🪽', '🪽']);
  const [isSpinning, setIsSpinning] = useState(false);
  const [gameResult, setGameResult] = useState(null);
  const [jackpotPool, setJackpotPool] = useState('5,000,000');

  const [showInstructions, setShowInstructions] = useState(() => {
    return localStorage.getItem('hideSlotInstructions') !== 'true';
  });

  const toggleInstructions = () => {
    setShowInstructions(false);
    localStorage.setItem('hideSlotInstructions', 'true');
  };

  const parsedBet = parseFloat(betAmount);
  const totalWager = (parsedBet || 0) * multiplier;

  const isInvalidWager = isNaN(parsedBet) || totalWager < 1 || totalWager > 10000;
  const buttonDisabled = isSpinning || isInvalidWager;

  const handleSpin = async () => {
    if (buttonDisabled) return;
    if (!userAddress || userAddress === "GUEST_MODE") return alert("🪽 Connect your wallet to initialize session.");

    if (totalWager < 1) return alert("🪽 Minimum composite wager is 1 SGC.");
    if (totalWager > 10000) return alert(`🛑 Treasury Protection: Max composite wager is 10,000 SGC. Your current total is ${totalWager}.`);

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
          Memos: [{ Memo: { MemoData: Buffer.from(gameMemo, 'utf8').toString('hex').toUpperCase(), MemoFormat: Buffer.from('text/plain', 'utf8').toString('hex').toUpperCase(), MemoType: Buffer.from('transaction-wager', 'utf8').toString('hex').toUpperCase() } }]
        };
        const prepared = await client.autofill(tx);
        const signed = xrplWallet.sign(prepared);
        const submitResult = await client.submitAndWait(signed.tx_blob);
        liveTxHash = submitResult.result.hash;
        await client.disconnect();
      } else if (['FLARE', 'FLR', 'XDC'].includes(selectedChain)) {
        const RPC_ENDPOINTS = { 'XDC': ['https://erpc.xinfin.network', 'https://rpc.xinfin.network'], 'FLARE': ['https://flare-api.flare.network/ext/C/rpc'] };
        let provider = null;
        for (const url of RPC_ENDPOINTS[selectedChain]) { try { provider = new ethers.JsonRpcProvider(url); await provider.getNetwork(); break; } catch (e) { continue; } }
        if (!provider) throw new Error("Network offline.");
        const evmWallet = ethers.Wallet.fromPhrase(mnemonic).connect(provider);
        activeSignerAddress = evmWallet.address;
        const CONTRACTS = { 'XDC': '0xd38109F587bd0326CAd60a18CF3C1ECD546809a6', 'FLARE': '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f' };
        const contractAddress = CONTRACTS[selectedChain];
        const tokenContract = new ethers.Contract(contractAddress, ["function transfer(address to, uint256 amount) returns (bool)"], evmWallet);
        const amountWei = ethers.parseUnits(totalWager.toString(), 18);
        let cleanRecipient = targetTreasury;
        if (cleanRecipient.startsWith('xdc')) cleanRecipient = '0x' + cleanRecipient.slice(3);
        const baseData = tokenContract.interface.encodeFunctionData("transfer", [cleanRecipient, amountWei]);
        const hexMemo = ethers.hexlify(ethers.toUtf8Bytes(gameMemo)).slice(2);
        const finalData = baseData + hexMemo;
        const feeData = await provider.getFeeData();
        const txResponse = await evmWallet.sendTransaction({ to: contractAddress, data: finalData, gasLimit: 150000n, gasPrice: feeData.gasPrice });
        await txResponse.wait(1);
        liveTxHash = txResponse.hash;
      }

      const gameResponse = await axios.post('https://seagull-xlm.xyz/api/games/slot-spin', { userId: activeSignerAddress, userWallet: activeSignerAddress, chain: selectedChain, amount: totalWager, txHash: liveTxHash });
      clearInterval(interval);
      if (gameResponse.data.success) {
        setReels(gameResponse.data.reels);
        setIsSpinning(false);
        setGameResult({
            type: gameResponse.data.outcome,
            msg: gameResponse.data.message,
            hash: liveTxHash
        });
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
        <h2 style={styles.title}>🦅 SEAGULLCOIN SLOTS</h2>
        <p style={styles.subtitle}>NON-CUSTODIAL CROSS-CHAIN SLOTS</p>
      </div>

      <div style={styles.jackpotContainer}>
        <label style={styles.label}>JACKPOT BALANCE</label>
        <div style={styles.jackpotVal}>🎰 {jackpotPool} SeagullCoin</div>
      </div>

      {showInstructions && (
        <div style={styles.instructions}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={styles.label}>Slots Instruction</label>
            <button onClick={toggleInstructions} style={styles.closeBtn}>[ X ]</button>
          </div>
          <ol style={{ paddingLeft: '15px', marginTop: '5px', marginBottom: 0, fontSize: '9px', color: '#666' }}>
            <li>Select Chain and Wager (XRPL: ensure SGC Trustline is set).</li>
            <li>Spin; Winnings are dispatched immediately upon detection.</li>
            <li>0.00001% chance of striking the 5,000,000 SeagullCoin Jackpot.</li>
          </ol>
        </div>
      )}

      <div style={styles.slotRow}>
        {reels.map((symbol, idx) => (
          <div key={idx} style={{ ...styles.reelBox, borderColor: gameResult?.type === 'WIN' ? '#00ffcc' : '#111' }}>
            <span style={styles.symbolText}>{symbol}</span>
          </div>
        ))}
      </div>

      {gameResult && (
        <div style={{ ...styles.resultBanner, color: gameResult.type === 'LOSS' ? '#ff4444' : '#00ffcc', borderColor: gameResult.type === 'LOSS' ? '#ff4444' : '#00ffcc' }}>
          <div>{gameResult.msg}</div>
          {gameResult.hash && (
            <a href={getExplorerLink(selectedChain, gameResult.hash)} target="_blank" rel="noreferrer" style={styles.link}>
              VERIFY TX: {gameResult.hash.substring(0, 10)}...{gameResult.hash.substring(gameResult.hash.length - 8)} ↗
            </a>
          )}
        </div>
      )}

      <div style={styles.controlBox}>
        <label style={styles.label}>SELECT SEAGULLCOIN CHAIN</label>
        <div style={styles.chainGroup}>
            {['XRPL', 'XDC', 'FLARE'].map((chain) => (
                <button
                    key={chain}
                    onClick={() => setSelectedChain(chain)}
                    style={{
                        ...styles.chainBtn,
                        background: selectedChain === chain ? '#00d4ff' : '#000',
                        color: selectedChain === chain ? '#000' : '#fff',
                        borderColor: selectedChain === chain ? '#00d4ff' : '#222'
                    }}
                    disabled={isSpinning}
                >
                    {chain}
                </button>
            ))}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <div style={{ flex: 2 }}>
            <label style={styles.label}>BASE WAGER AMOUNT</label>
            <input type="number" placeholder="1.00" value={betAmount} min="1" max={10000 / multiplier} step="1" onChange={(e) => setBetAmount(e.target.value)} style={styles.input} disabled={isSpinning} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>MULTIPLIER</label>
            <div style={styles.multGroup}>
              {[1, 1.5, 3].map((m) => (
                <button key={m} onClick={() => setMultiplier(m)} style={{ ...styles.multBtn, background: multiplier === m ? '#00d4ff' : '#000', color: multiplier === m ? '#000' : '#666' }} disabled={isSpinning}>{m}x</button>
              ))}
            </div>
          </div>
        </div>
        <div style={styles.riskBreakdown}>
          <span>TOTAL COMPOSITE RISK:</span>
          <span style={{ color: '#ffcc00' }}>{totalWager.toFixed(2)} SGC</span>
        </div>
        <button onClick={handleSpin} style={{ ...styles.spinButton, opacity: buttonDisabled ? 0.5 : 1, cursor: buttonDisabled ? 'not-allowed' : 'pointer', background: buttonDisabled ? '#333' : 'linear-gradient(45deg, #00d4ff, #00ffcc)', color: buttonDisabled ? '#ff4444' : '#000' }} disabled={buttonDisabled}>{isSpinning ? 'SPINNING REELS...' : isInvalidWager ? '⚠️ INVALID WAGER AMOUNT' : '⚡ TRIGGER SYSTEM SPIN'}</button>
      </div>
    <div style={{ ...styles.controlBox, marginTop: '15px', background: '#000', border: '1px dashed #222' }}>
        <label style={styles.label}>Paytable Probabilities</label>
        <div style={{ fontSize: '9px', color: '#ffffff', lineHeight: '1.6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Jackpot:</span> <span>~0.00001%</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Triple (3x):</span> <span>4.99999%</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Double (1.5x):</span> <span>30.0%</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Loss:</span> <span>65.0%</span></div>
        </div>
      </div>
    </div>
  );
};
const styles = {
  container: { background: '#080808', border: '1px solid #1a1a1a', padding: '25px', borderRadius: '25px', color: '#fff', maxWidth: '420px', margin: 'auto' },
  header: { borderBottom: '1px solid #222', paddingBottom: '15px', marginBottom: '20px', textAlign: 'center' },
  title: { margin: 0, fontSize: '18px', fontWeight: '900', color: '#00d4ff', letterSpacing: '1px' },
  subtitle: { margin: '4px 0 0 0', fontSize: '8px', color: '#444', fontWeight: 'bold', letterSpacing: '2px' },
  instructions: { background: '#020202', border: '1px dashed #222', borderRadius: '15px', padding: '12px', marginBottom: '20px' },
  closeBtn: { background: 'transparent', border: 'none', color: '#00d4ff', fontSize: '9px', cursor: 'pointer', fontWeight: 'bold', padding: '2px 5px' },
  jackpotContainer: { background: '#000', border: '1px dashed #ffcc00', borderRadius: '15px', padding: '12px', textAlign: 'center', marginBottom: '20px' },
  jackpotVal: { fontSize: '20px', fontWeight: '900', color: '#ffcc00', marginTop: '5px' },
  slotRow: { display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '25px' },
  reelBox: { width: '90px', height: '110px', background: '#000', border: '1px solid #111', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  symbolText: { fontSize: '42px' },
  controlBox: { display: 'flex', flexDirection: 'column', gap: '10px', background: '#020202', padding: '15px', borderRadius: '18px', border: '1px solid #111' },
  label: { fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' },
  input: { padding: '12px', background: '#000', color: '#fff', border: '1px solid #111', borderRadius: '10px', fontSize: '13px', width: '100%', boxSizing: 'border-box' },
  chainGroup: { display: 'flex', gap: '8px', marginBottom: '10px' },
  chainBtn: { flex: 1, padding: '11px', border: '1px solid', borderRadius: '8px', fontSize: '10px', fontWeight: '900', cursor: 'pointer' },
  multGroup: { display: 'flex', gap: '4px' },
  multBtn: { flex: 1, padding: '11px 5px', border: '1px solid #111', borderRadius: '8px', fontSize: '10px', fontWeight: '900' },
  riskBreakdown: { display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.01)', border: '1px dashed #222', borderRadius: '8px' },
  spinButton: { width: '100%', padding: '15px', border: 'none', borderRadius: '12px', fontWeight: 'bold', transition: 'all 0.3s ease' },
  resultBanner: { border: '1px solid', padding: '12px', borderRadius: '12px', background: 'rgba(0,0,0,0.5)', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', marginBottom: '15px' },
  link: { color: '#00d4ff', fontSize: '10px', textDecoration: 'none', display: 'block', marginTop: '5px', wordBreak: 'break-all' }
};

export default SlotMachine;
