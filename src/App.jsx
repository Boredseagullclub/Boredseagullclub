import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { useBridge } from './hooks/useBridge';
import Dashboard from './views/Dashboard.jsx';
import SeagullExplorer from './components/SeagullExplorer';
import SlotMachine from './components/SlotMachine';
import AgentGateway from './components/AgentGateway';
import BridgeWidget from './components/BridgeWidget';
import Swap from './components/Swap';
import ChartsAndSwap from './components/ChartsAndSwap'; // 🦅 Imported chart assembly safely
import { X, ExternalLink } from 'lucide-react';
import * as xrpl from 'xrpl';
import * as StellarSdk from '@stellar/stellar-sdk';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';


function App() {
  const [id, setId] = useState(localStorage.getItem('sovereign_local'));
  const [showImport, setShowImport] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  const [revealSeed, setRevealSeed] = useState(false);
  const [secretInput, setSecretInput] = useState("");
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");

  // 🎰 GLOBAL NAVIGATION STATE CONTROLLERS
  const [isGameOpen, setIsGameOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const { user, loading } = useBridge(id);

  const handleCreateWallet = async () => {
    try {
      const response = await fetch('/api/auth/generate-mnemonic');
      const data = await response.json();
      if (data.mnemonic) {
        setGeneratedMnemonic(data.mnemonic);
        setShowReveal(true);
      }
    } catch (err) {
      alert("🦅 Generation failed.");
    }
  };

    const handleImport = async () => {
    if (!secretInput) return alert("🦅 Enter a seed!");
    const cleanSecret = secretInput.trim();
    const wordCount = cleanSecret.split(/\s+/).length;

    if (wordCount !== 12 && wordCount !== 24 && cleanSecret.length < 30) {
      return alert("🦅 Invalid Format. Please enter 12 or 24 words.");
    }

    try {
      localStorage.setItem('secret', cleanSecret);

      // 🦅 1. CLIENT-SIDE DERIVATION: Instantly generate the XRPL and XLM addresses
      const xrplWallet = xrpl.Wallet.fromMnemonic(cleanSecret);
      localStorage.setItem('cached_xrpl_address', xrplWallet.address);

      const seed = await bip39.mnemonicToSeed(cleanSecret);
      const derived = derivePath("m/44'/148'/0'", seed.toString('hex'));
      const keypair = StellarSdk.Keypair.fromRawEd25519Seed(derived.key);
      localStorage.setItem('cached_stellar_address', keypair.publicKey());

      // 🦅 2. BACKEND SYNC: Your existing logic to fetch the EVM identity
      const response = await fetch('/api/auth/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: cleanSecret })
      });
      const data = await response.json();

      const rawAddress = data.publicAddress || data.address || data.account || 'Unknown Vault';

      localStorage.setItem('sovereign_local', rawAddress);
      localStorage.setItem('seagull_user_id', rawAddress);
      
      // Pass the raw EVM address straight into the state so the balances endpoint doesn't fail
      setId(rawAddress);
      setSecretInput("");
      setShowImport(false);
    } catch (err) {
      // 🦅 3. THE FIX: No more "sovereign_user" dummy trap. It fails loudly now.
      alert("🦅 Login Failed. Check connection or seed phrase.");
      localStorage.removeItem('sovereign_local');
      setId(null);
    }
  };


  const handleLogout = () => {
    localStorage.clear();
    setId(null);
    window.location.reload();
  };

  const LoginView = () => (
    <div style={loginBgStyle}>
      <div style={glowTopStyle}></div>
      <div style={glowBottomStyle}></div>

      <div style={loginCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '30px' }}>
          <div style={logoRingStyle}>
            <span style={{ fontSize: '40px' }}>🪽</span>
          </div>
        </div>

        <h1 style={titleStyle}>
          SEAGULL<span style={{ color: '#00d4ff' }}>WALLET</span>
        </h1>
        <p style={subtitleStyle}>Sovereign Asset Interface</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <button onClick={handleCreateWallet} style={primaryBtnStyle}>
            INITIALIZE IDENTITY
          </button>
          <button onClick={() => setShowImport(true)} style={secondaryBtnStyle}>
            IMPORT RECOVERY PHRASE
          </button>
        </div>

        {/* 🏛️ PUBLIC BRIDGE BUTTON */}
        <Link to="/bridge" style={{ textDecoration: 'none', marginTop: '25px', display: 'block' }}>
          <div style={publicBridgeBtnStyle}>
            <span style={{ color: '#ffcc00', fontWeight: '900', fontSize: '11px', letterSpacing: '1px' }}>
              PUBLIC BRIDGE ✅ <ExternalLink size={14} style={{ marginLeft: '5px', verticalAlign: 'middle' }} />
            </span>
          </div>
        </Link>

        {/* 🛰️ AI GATEWAY STATUS */}
        <div style={restrictedGatewayStyle}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'rgba(0, 255, 204, 0.05)',
            padding: '6px 15px',
            borderRadius: '12px',
            border: '1px solid rgba(0, 255, 204, 0.2)',
            boxShadow: '0 0 15px rgba(0, 255, 204, 0.05)'
          }}>
            <span style={{ fontSize: '14px' }}>🤖</span>
            <span style={{ color: '#00ffcc', fontWeight: '900', textShadow: '0 0 10px rgba(0, 255, 204, 0.5)' }}>AI_GATEWAY:</span>
            <span style={{ color: '#fff', letterSpacing: '0.5px' }}>/agent-gateway (RESTRICTED)</span>
          </div>
        </div>
        <div style={footerStyle}>
          <p>NON-CUSTODIAL MULTI-CHAIN SYSTEM // V2.0</p>
          <Link to="/agent-gateway" style={{ opacity: 0, fontSize: '1px', position: 'absolute' }}>.</Link>
        </div>
      </div>

      {showReveal && (
        <div style={overlayStyle}>
          <div style={{...importModalStyle, maxWidth: '500px', textAlign: 'center', border: '1px solid #00d4ff'}}>
            <h2 style={{ fontSize: '20px', fontStyle: 'italic', fontWeight: '900', color: '#00d4ff', marginBottom: '10px' }}>SOVEREIGN BACKUP</h2>
            <p style={{ fontSize: '11px', color: '#666', marginBottom: '30px' }}>Write down these 24 words. If you lose them, your assets are gone forever.</p>

            <div onClick={() => setRevealSeed(!revealSeed)} style={seedBoxStyle}>
              {!revealSeed && (
                <div style={blurOverlayStyle}>
                  <span style={{ fontSize: '10px', fontWeight: '900', letterSpacing: '3px', color: '#00d4ff' }}>CLICK TO REVEAL SEED</span>
                </div>
              )}
              <p style={{ ...seedTextStyle, filter: revealSeed ? 'none' : 'blur(4px)' }}>
                {generatedMnemonic}
              </p>
            </div>
            <button
              onClick={() => {
                setShowReveal(false);
                setRevealSeed(false);
                setSecretInput(generatedMnemonic);
                setShowImport(true);
              }}
              style={{ ...primaryBtnStyle, marginTop: '35px', width: '100%' }}
            >
              I HAVE SECURED MY PHRASE
            </button>
          </div>
        </div>
      )}

      {showImport && (
        <div style={overlayStyle}>
          <div style={{...importModalStyle, maxWidth: '450px'}}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
              <h2 style={{ margin: 0, fontSize: '24px', fontStyle: 'italic', fontWeight: '900' }}>VAULT ACCESS</h2>
              <button onClick={() => setShowImport(false)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><X /></button>
            </div>
            <textarea
              placeholder="Enter words separated by spaces..."
              style={{ ...modalInputStyle, height: '120px', resize: 'none', padding: '20px', fontSize: '14px', lineHeight: '1.5' }}
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
            />
            <button onClick={handleImport} style={{ ...primaryBtnStyle, marginTop: '30px', width: '100%' }}>
              UNLOCK DASHBOARD
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const hideHeader = (!id && window.location.pathname === '/rich-list') ||
                     window.location.pathname === '/bridge' ||
                     window.location.pathname === '/slots';

  return (
    <Router>
      {/* 🎰 THE UNIFIED MAIN TOP BAR */}
      {id && (
        <div style={globalCasinoHeaderStyle}>
          {/* ☰ FAR LEFT: Hamburger Menu Trigger */}
          <div
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            style={{ ...hamburgerLeftGroupStyle, cursor: 'pointer' }}
          >
            <span style={hamburgerLineStyle}></span>
            <span style={hamburgerLineStyle}></span>
            <span style={hamburgerLineStyle}></span>
          </div>

          {/* 📋 CLICKABLE NAV MENU DROPDOWN PANEL */}
          {isMenuOpen && (
            <div style={dropdownMenuOverlayStyle}>
              <div style={dropdownHeaderStyle}>
                <span style={{ color: '#00d4ff', fontSize: '10px', fontWeight: '900', letterSpacing: '1px' }}>CORE NAV TERMINAL</span>
                <button onClick={() => setIsMenuOpen(false)} style={menuCloseXStyle}>✕</button>
              </div>
              <div style={menuLinkContainerStyle}>
                <Link to="/" onClick={() => setIsMenuOpen(false)} style={menuLinkItemStyle}>🏛️ SOVEREIGN WALLET</Link>
                <Link to="/swap" onClick={() => setIsMenuOpen(false)} style={menuLinkItemStyle}>🔄 LIVE EXCHANGE</Link>
                <Link to="/explorer" onClick={() => setIsMenuOpen(false)} style={menuLinkItemStyle}>🛰️ SEAGULL EXPLORER</Link>
                <Link to="/agent-gateway" onClick={() => setIsMenuOpen(false)} style={menuLinkItemStyle}>🤖 AI AGENT GATEWAY</Link>
              </div>
            </div>
          )}

          {/* 🎰 VERY TOP RIGHT: Compact Casino Trigger Button */}
          <button
            onClick={() => setIsGameOpen(!isGameOpen)}
            style={{
              ...casinoTriggerBtnStyle,
              borderColor: isGameOpen ? '#ff4444' : '#00d4ff',
              color: isGameOpen ? '#ff4444' : '#00d4ff',
            }}
          >
            {isGameOpen ? '✕ CLOSE' : '🎰 PLAY SLOTS'}
          </button>
        </div>
      )}

      {/* 🦅 IMMERSIVE OVERLAY MODAL */}
      {isGameOpen && id && (
        <div style={modalBackdropStyle}>
          <div style={modalContainerPaneStyle}>
            <div style={modalInnerCloseHeaderStyle}>
              <button onClick={() => setIsGameOpen(false)} style={modalInnerXStyle}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: '85vh', padding: '10px 10px 25px 10px' }}>
              <SlotMachine userAddress={id} balances={user?.balances || []} />
            </div>
          </div>
        </div>
      )}

      <Routes>
        {/* 🦅 Root: Login vs Dashboard */}
        <Route path="/" element={!id ? <LoginView /> : <Dashboard userAddress={id} userMnemonic={localStorage.getItem('secret')} onLogout={handleLogout} />} />

        {/* 📊 EXTERNAL UNPROTECTED PUBLIC URL */}
        <Route path="/rich-list" element={
          <div style={{ padding: '20px', background: '#000', minHeight: '100vh' }}>
            <SeagullExplorer standalone={true} />
          </div>
        } />

        {/* 🏛️ Public Functional Bridge (Guest Mode Supported) */}
        <Route path="/bridge" element={
          <div style={{ padding: '40px 20px', background: '#000', minHeight: '100vh' }}>
            <BridgeWidget
              userAddress={id || "GUEST_MODE"}
              balances={user?.balances || []}
              userWallets={user?.wallets}
              userMnemonic={localStorage.getItem('secret')}
            />
            <Link to="/" style={{ color: '#444', fontSize: '10px', display: 'block', textAlign: 'center', marginTop: '20px', textDecoration: 'none' }}>← BACK TO TERMINAL</Link>
          </div>
        } />

        {/* 🔄 Live Swap Interface Track */}
        <Route path="/swap" element={
          <div style={{ padding: '40px 20px', background: '#000', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: '30px', alignItems: 'center', justifyContent: 'center' }}>
            {/* 📊 The Live Cross-Chain Financial Chart Panel */}
            <ChartsAndSwap />
            {/* 🔄 The Core Ledger Swap Payout Processing Card */}
            <Swap
              userAddress={id}
              userMnemonic={localStorage.getItem('secret') || localStorage.getItem('seagull_mnemonic')}
            />
          </div>
        } />

        <Route path="/explorer" element={<SeagullExplorer />} />
        <Route path="/agent-gateway" element={<AgentGateway userAddress={id} />} />

        <Route path="/slots" element={
          <div style={{ padding: '40px 20px', background: '#000', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SlotMachine userAddress={id || "GUEST_MODE"} balances={user?.balances || []} />
            <Link to="/" style={{ color: '#444', fontSize: '10px', display: 'block', textAlign: 'center', marginTop: '20px', textDecoration: 'none' }}>← RETURN TO INTERFACE</Link>
          </div>
        } />
      </Routes>
    </Router>
  );
}

// 🏛️ MASTER STYLE SYSTEM
const loginBgStyle = { minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', fontFamily: 'sans-serif', color: '#fff' };
const glowTopStyle = { position: 'absolute', top: '-10%', left: '-10%', width: '50%', height: '50%', background: 'rgba(0, 212, 255, 0.08)', filter: 'blur(120px)', borderRadius: '50%' };
const glowBottomStyle = { position: 'absolute', bottom: '-10%', right: '-10%', width: '40%', height: '40%', background: 'rgba(0, 80, 255, 0.08)', filter: 'blur(120px)', borderRadius: '50%' };
const loginCardStyle = { width: '90%', maxWidth: '400px', background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '50px 30px', borderRadius: '50px', textAlign: 'center', zIndex: 10, boxShadow: '0 40px 100px rgba(0,0,0,0.8)', boxSizing: 'border-box' };
const logoRingStyle = { width: '100px', height: '100px', borderRadius: '50%', border: '2px solid #00d4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 30px rgba(0, 212, 255, 0.15)', background: '#080808' };
const titleStyle = { margin: 0, fontSize: '42px', fontWeight: '900', fontStyle: 'italic', letterSpacing: '-2px', lineHeight: '1', whiteSpace: 'nowrap' };
const subtitleStyle = { fontSize: '10px', color: '#444', letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '50px', fontWeight: 'bold' };
const primaryBtnStyle = { padding: '20px', background: '#00d4ff', color: '#000', fontWeight: '900', border: 'none', borderRadius: '30px', cursor: 'pointer', fontSize: '15px', letterSpacing: '0.5px' };
const secondaryBtnStyle = { padding: '20px', background: 'transparent', color: '#666', fontWeight: 'bold', border: '1px solid #222', borderRadius: '30px', cursor: 'pointer', fontSize: '11px', letterSpacing: '1px' };
const publicBridgeBtnStyle = { padding: '18px', background: 'rgba(255, 204, 0, 0.03)', border: '1px solid rgba(255, 204, 0, 0.3)', borderRadius: '30px', cursor: 'pointer', transition: '0.3s' };
const restrictedGatewayStyle = { marginTop: '25px', fontSize: '9px', fontFamily: 'monospace', letterSpacing: '1px', borderTop: '1px solid #111', paddingTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.8 };
const footerStyle = { marginTop: '30px', paddingTop: '20px', color: '#222', fontSize: '9px', letterSpacing: '2px', fontWeight: 'bold' };
const overlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.98)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(10px)' };
const importModalStyle = { background: '#0c0c0c', padding: '45px', borderRadius: '50px', border: '1px solid #1a1a1a', width: '90%', maxWidth: '400px', color: '#fff' };
const modalInputStyle = { width: '100%', background: '#000', border: '1px solid #222', padding: '22px', borderRadius: '25px', color: '#00d4ff', fontFamily: 'monospace', fontSize: '15px', boxSizing: 'border-box', outline: 'none' };
const seedBoxStyle = { background: '#000', padding: '25px', borderRadius: '30px', border: '1px solid #1a1a1a', cursor: 'pointer', position: 'relative', overflow: 'hidden', minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const blurOverlayStyle = { position: 'absolute', inset: 0, backdropFilter: 'blur(15px)', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' };
const seedTextStyle = { fontFamily: 'monospace', fontSize: '14px', color: '#00d4ff', margin: 0, lineHeight: '1.8' };

const globalCasinoHeaderStyle = { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', boxSizing: 'border-box', height: '48px' };
const hamburgerLeftGroupStyle = { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '22px', height: '14px', cursor: 'pointer' };
const hamburgerLineStyle = { width: '100%', height: '2px', backgroundColor: '#fff', borderRadius: '2px', display: 'block' };
const casinoTriggerBtnStyle = { background: 'transparent', border: 'none', fontSize: '14px', fontWeight: '300', cursor: 'pointer', outline: 'none', padding: '0 5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' };
const modalBackdropStyle = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 99998, padding: '20px', boxSizing: 'border-box' };
const modalContainerPaneStyle = {
  background: '#080808',
  borderRadius: '30px',
  border: '1px solid #1c1c1c',
  boxShadow: '0 25px 70px rgba(0,0,0,0.9), 0 0 40px rgba(0, 212, 255, 0.05)',
  maxWidth: '650px',
  width: '95%',
  position: 'relative',
  boxSizing: 'border-box'
};

const modalInnerCloseHeaderStyle = { display: 'flex', justifyContent: 'flex-end', padding: '15px 20px 0 0', position: 'absolute', right: '10px', top: '10px', zIndex: 99999 };
const modalInnerXStyle = { background: 'none', border: 'none', color: '#444', fontSize: '16px', cursor: 'pointer', outline: 'none', fontWeight: 'bold', transition: 'color 0.2s' };
const dropdownMenuOverlayStyle = { position: 'absolute', top: '50px', left: '16px', background: '#0c0c0c', border: '1px solid #1a1a1a', borderRadius: '16px', width: '240px', padding: '15px', boxShadow: '0 20px 50px rgba(0,0,0,0.9), 0 0 20px rgba(0,212,255,0.02)', zIndex: 100000, display: 'flex', flexDirection: 'column', gap: '15px' };
const dropdownHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #111', paddingBottom: '8px' };
const menuCloseXStyle = { background: 'none', border: 'none', color: '#444', fontSize: '14px', cursor: 'pointer', outline: 'none' };
const menuLinkContainerStyle = { display: 'flex', flexDirection: 'column', gap: '12px' };
const menuLinkItemStyle = { color: '#fff', textDecoration: 'none', fontSize: '12px', fontWeight: 'bold', fontFamily: 'sans-serif', letterSpacing: '0.5px', padding: '6px 0', display: 'block', borderBottom: '1px solid #0f0f0f' };

export default App;
