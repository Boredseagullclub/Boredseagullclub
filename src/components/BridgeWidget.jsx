import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import * as xrpl from 'xrpl';
import * as StellarSdk from '@stellar/stellar-sdk';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const TREASURY = {
  XRPL: { address: 'rVKvTekTiqygS9qB27MPmsoDLyuD8PksF', tag: true },
  XLM: { address: 'GD2VMYH62JD2ZGTMMWFCU5YNMASC5NWZ5FM5WN2GWLYAACYXP6BKG44I', memo: true },
  HBAR: { address: '0.0.10419620', memo: true },
  XDC: { address: 'xdc3B51F488f729e5Cfa566990Fd7f069F364b6984D', memo: false },
  FLARE: { address: '0x6FeD6C7501Ac980548DAE096F022Ae3758E6DecC', memo: false }
};

const SOVEREIGN_OPTIONS = [
  { id: 'XRP_NATIVE', label: 'XRP',           chain: 'XRPL',  asset: 'XRP' },
  { id: 'SGC_XRPL',  label: 'SeagullCoin (XRPL)',    chain: 'XRPL',  asset: 'SEAGULLCOIN' },
  { id: 'SGH_XRPL',  label: 'SeagullCash (XRPL)',    chain: 'XRPL',  asset: 'SEAGULLCASH' },
  { id: 'XLM_NATIVE', label: 'XLM',        chain: 'XLM',   asset: 'XLM' },
  { id: 'SGH_XLM',   label: 'SeagullCash (Stellar)', chain: 'XLM',   asset: 'SEAGULLCASH' },
  { id: 'HBAR_NATIVE',label: 'HBAR',        chain: 'HBAR',  asset: 'Hbar' },
  { id: 'SGH_HBAR',  label: 'SeagullCash (Hedera)',  chain: 'HBAR',  asset: 'SEAGULLCASH' },
  { id: 'XDC_NATIVE', label: 'XDC',    chain: 'XDC',   asset: 'XDC' },
  { id: 'SGC_XDC',   label: 'SeagullCoin (XDC)',     chain: 'XDC',   asset: 'SEAGULLCOIN' },
  { id: 'FLR_NATIVE', label: 'FLR',  chain: 'FLARE', asset: 'FLR' },
  { id: 'SGC_FLR',   label: 'SeagullCoin (Flare)',   chain: 'FLARE', asset: 'SEAGULLCOIN' }
];

const BridgeWidget = ({ userAddress, userWallets, balances, userMnemonic, kycStatus }) => {
  const [activeTab, setActiveTab] = useState(userAddress === "GUEST_MODE" ? 'BRIDGE' : 'SOVEREIGN WALLET');
  const [limitError, setLimitError] = useState("");
  const [userHasSavedEmail, setUserHasSavedEmail] = useState(false);
  const [activeTickets, setActiveTickets] = useState([]);
  const [showIsoPortal, setShowIsoPortal] = useState(false);
  const [isoMessages, setIsoMessages] = useState([]);
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [sendForm, setSendForm] = useState({ amount: '', recipient: '', memo: '' });
  const [uiMemoText, setUiMemoText] = useState('');
  const [serverMemo, setServerMemo] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [justActivated, setJustActivated] = useState([]);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [isNativeMode, setIsNativeMode] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [hederaView, setHederaView] = useState('EVM'); // 'EVM' or 'NATIVE'
  const [resolvedHbarId, setResolvedHbarId] = useState('Loading...');
  const [successMsg, setSuccessMsg] = useState('');
  const [messages, setMessages] = useState([
    { role: 'system', text: "Connectivity issue or bridge stall? Describe it here and an admin will assist.", timestamp: new Date() }
  ]);
  const [serverDepositAddr, setServerDepositAddr] = useState('');
  const [txDetails, setTxDetails] = useState({
    fromOptionId: 'SGH_XRPL',
    toOptionId: 'SGH_XLM',
    amount: '',
    destinationAddress: '',
    memo: ''
  });
  const [replyingTo, setReplyingTo] = useState(null);
  const [adminMsg, setAdminMsg] = useState('');
  const [isProcessingTrust, setIsProcessingTrust] = useState(null);
  const [errorToast, setErrorToast] = useState({ show: false, msg: "" });
  
  const source = SOVEREIGN_OPTIONS.find(o => o.id === txDetails.fromOptionId);
  const target = SOVEREIGN_OPTIONS.find(o => o.id === txDetails.toOptionId);

  const getMnemonic = () => localStorage.getItem('seagull_mnemonic') || userMnemonic;

  const estPayout = useMemo(() => {
    if (!txDetails.amount || !source || !target) return "0.00";
    let amt = parseFloat(txDetails.amount);
    if (isNaN(amt)) return "0.00";
    if (source.asset === 'SEAGULLCOIN' && target.asset === 'SEAGULLCASH') amt *= 1000;
    if (source.asset === 'SEAGULLCASH' && target.asset === 'SEAGULLCOIN') amt /= 1000;
    return (amt * 0.994).toFixed(4);
  }, [txDetails.amount, source, target]);

  const ADMIN_WALLET = "0x870f64e73e7d2dc5022b4b74e58c323b3148a984";

  useEffect(() => {
    if (!userAddress || userAddress === "GUEST_MODE") return;
        const fetchTickets = async () => {
      try {
        // 🦅 ONLY fetch bridge transaction tickets here. Support handles its own history now.
        const bridgeRes = await axios.get(`/api/bridge/tickets/${userAddress}`);
        
        if (bridgeRes.data?.success) {
          const sorted = bridgeRes.data.tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          setActiveTickets(sorted);
        }
      } catch (err) {
        console.error("Heartbeat sync failed");
      }
    };
    fetchTickets();
    const ticker = setInterval(fetchTickets, 5000);
    return () => clearInterval(ticker);
  }, [userAddress, activeTab]);

  useEffect(() => {
    if (!showIsoPortal || !userAddress || userAddress === "GUEST_MODE") return;
    const fetchIsoData = async () => {
      try {
        const res = await axios.get(`https://seagull-xlm.xyz/api/iso-terminal`);
        setIsoMessages(res.data);
      } catch (err) {
        console.error("ISO Terminal Heartbeat failed");
      }
    };
    fetchIsoData();
    const ticker = setInterval(fetchIsoData, 5000);
    return () => clearInterval(ticker);
  }, [showIsoPortal, userAddress]);

  // 🦅 1. Dynamic Balance Heartbeat (Every 15 seconds)
  useEffect(() => {
    if (!userAddress || userAddress === "GUEST_MODE") return;

    const refreshBalances = async () => {
      try {
        const res = await axios.get(`https://seagull-xlm.xyz/api/wallet/balances/${userAddress}`);
        if (res.data.success) {
          if (typeof setBalances === 'function') setBalances(res.data.balances);
        }
      } catch (err) {
        console.error("Balance sync pulse failed");
      }
    };

    const pulse = setInterval(refreshBalances, 15000); 
    return () => clearInterval(pulse);
  }, [userAddress]);

  // 🦅 PRODUCTION RATIO: NON-DESTRUCTIVE CONVERSATION RECOVERY HOOK
  useEffect(() => {
    let isMounted = true;
    if (showSupport && userAddress && userAddress !== "GUEST_MODE") {
      axios.get(`/api/bridge/support/history/${userAddress.toLowerCase()}`)
        .then(res => {
          if (!isMounted) return;
          if (res.data?.success && res.data.tickets) {
            const historyMessages = [];

            // Re-construct conversation threads based on DB records chronologically
            res.data.tickets.forEach(ticket => {
              historyMessages.push({
                id: `${ticket._id}-user`,
                role: 'user',
                text: ticket.issue,
                timestamp: new Date(ticket.createdAt)
              });

              if (ticket.adminNote) {
                historyMessages.push({
                  id: `${ticket._id}-admin`,
                  role: 'admin',
                  text: ticket.adminNote,
                  timestamp: new Date(ticket.updatedAt || ticket.createdAt)
                });
              }
            });

            setMessages(prev => {
              const existingIds = new Set(prev.map(m => m.id).filter(Boolean));
              const freshHistory = historyMessages.filter(m => !existingIds.has(m.id));
              return [...freshHistory, ...prev].sort((a, b) => a.timestamp - b.timestamp);
            });
          }
        })
        .catch(err => console.error("🦅 SYSTEM STALL: Thread claim retrieval failure ->", err.message));
    }
    return () => { isMounted = false; };
  }, [showSupport, userAddress]);

  useEffect(() => {
    if (target && userWallets) {
      const c = target.chain.toUpperCase();
      const addr = userWallets[c.toLowerCase()] || userWallets[c] || userAddress;
      if (addr && addr !== txDetails.destinationAddress) {
        setTxDetails(prev => ({ ...prev, destinationAddress: addr }));
      }
    }
  }, [target, userWallets, userAddress]);

  const handleCopy = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setShowCopyToast(true);
    setTimeout(() => { setShowCopyToast(false); }, 1500);
  };

  const handleLogout = () => {
    localStorage.removeItem('sovereign_local');
    localStorage.setItem('sovereign_local', '');
    localStorage.removeItem('secret');
    localStorage.removeItem('seagull_user_id');
    localStorage.removeItem('seagull_mnemonic');
    localStorage.removeItem('token');
    localStorage.clear();
    window.location.href = "/";
  };

  const hasActiveTrustline = (chain, asset) => {
    const isCoin = asset === 'SEAGULLCOIN' || asset === 'SGCN' || asset === 'SGC';
    const assetKey = isCoin ? 'SeagullCoin' : 'SeagullCash';

    const match = balances.some(b =>
      b.chain === chain &&
      (b.symbol === assetKey || b.symbol === asset)
    );

    return match || justActivated.includes(`${chain}_${assetKey}`);
  };

  const triggerError = (msg) => {
    setErrorToast({ show: true, msg: msg.toUpperCase() });
    setTimeout(() => setErrorToast({ show: false, msg: "" }), 5000); 
  };

  const handleCreateTicket = async (message) => {
    if (!message || !message.trim()) return;
    const userMsg = { role: 'user', text: message, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    try {
      const res = await axios.post('/api/bridge/support/ticket', {
        userId: userAddress,
        memo: "BRIDGE_WIDGET",
        issue: message,
        email: userEmail || 'no-email-provided@ecosystem.com' 
      });
      if (res.data.success) {
        const supportRes = await axios.get(`/api/bridge/support/history/${userAddress}`);

        if (supportRes.data?.success) {
          const freshSupport = supportRes.data.tickets.map(t => ({ 
            ...t,
            isSupport: true, 
            status: t.resolved ? 'RESOLVED' : (t.adminNote ? 'REPLIED' : 'OPEN')
          }));

          setActiveTickets(prev => {
            const bridgeOnly = prev.filter(ticket => !ticket.isSupport);
            return [...bridgeOnly, ...freshSupport].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          });
        }                                                                                                   
        setMessages(prev => [...prev, { role: 'system', text: "🦅 Ticket Created. An admin will respond here shortly.", timestamp: new Date() }]);
      }
    } catch (err) {
      console.error("🦅 FAIL:", err.message);
      setMessages(prev => [...prev, { role: 'system', text: "❌ Connection stalled. Try again.", timestamp: new Date() }]);
    }
  };

  const isValidAddress = (chain, address) => {
    if (!address) return false;
    try {
      switch (chain.toUpperCase()) {
        case 'XRPL':
          return xrpl.isValidAddress(address);
        case 'XLM': 
          StellarSdk.Keypair.fromPublicKey(address);
          return true;
        case 'XDC':
          return /^xdc[a-fA-F0-9]{40}$/.test(address) || ethers.isAddress(address);
        case 'HBAR':
          return /^0\.0\.[0-9]+$/.test(address) || ethers.isAddress(address);
        case 'FLARE':
        case 'FLR': 
        case 'ETH':
          return ethers.isAddress(address);
        default:
          return true; 
      }
    } catch (e) {
      return false;
    }
  };

  const syncUserProfile = async () => {
    if (!userAddress) return; 
    try {
      const res = await axios.get(`https://seagull-xlm.xyz/api/bridge/user/profile/${userAddress}`);
      if (res.data.user && res.data.user.email) {
        setUserEmail(res.data.user.email);
        setUserHasSavedEmail(true);
      }
    } catch (err) {
      console.error("Profile sync failed:", err); 
    }
  };

  useEffect(() => { 
    syncUserProfile();
  }, [userAddress]); 

  const handleUserReply = async (ticketId, message) => {
    try {
      const res = await axios.post('/api/bridge/user/support/reply', { ticketId, message });
      if (res.data.success) {
        const updated = await axios.get('/api/bridge/admin/support/all', {
          headers: { 'x-admin-address': userAddress }
        });
        setActiveTickets(updated.data.tickets);
      }
    } catch (err) {
      console.error("🦅 REPLY ERROR:", err);
    }
  };
  
  // 🦅 THE IDENTITY RESOLVER
  const resolveHederaIdentity = async (evmAddress) => {
    try {
        const response = await axios.get(
            `https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`
        );
        return response.data.account;
    } catch (err) {
        console.error("🪽 Hedera ID not found for this address."); 
        return null;
    }
  };                                                                                                          

  const handleResolveTicket = async (ticketId) => { 
    try {
      const finalAddr = String(userAddress || "0x870f64e73e7d2dc5022b4b74e58c323b3148a984").toLowerCase();
      const res = await axios.post('https://seagull-xlm.xyz/api/bridge/support/resolve', {
        ticketId, 
        adminAddress: finalAddr
      });

      if (res.data.success) { 
        const refreshRes = await axios.get(`https://seagull-xlm.xyz/api/bridge/support/all-tickets?adminAddress=${finalAddr}`);
        if (refreshRes.data.success) {
          const activeOnly = refreshRes.data.tickets.filter(t => !t.resolved);
          setActiveTickets(activeOnly);
        }
      }
    } catch (err) {
      console.error("🦅 RESOLVE STALL:", err.message);
      alert("State modification failed: " + (err.response?.data?.message || err.message)); 
    }
  };

  const handleExecuteSend = async () => {
    const mnemonic = localStorage.getItem('secret') || userMnemonic;
    if (!sendForm.amount || !sendForm.recipient) return triggerError("🪽 Details missing.");
    if (!mnemonic || mnemonic === "null" || mnemonic === "undefined") { 
      return triggerError("🪽 Vault Locked: No secret found.");
    }

    setIsSending(true); 
    
    try {
      // 🦅 1. IMMEDIATE NATIVE HBAR BYPASS
      if (isNativeMode && selectedAsset.chain === 'HBAR') { 
        const response = await axios.post('https://seagull-xlm.xyz/api/wallet/broadcast', {
          chain: 'HBAR', 
          type: 'NATIVE_SDK',
          asset: selectedAsset.asset, 
          amount: sendForm.amount,
          recipient: sendForm.recipient.trim(), 
          memo: sendForm.memo,
          senderAddress: userAddress 
        });
        if (response.data.success) {
          setShowSendModal(false); 
          setSendForm({ amount: '', recipient: '', memo: '' });
          setUiMemoText(''); 
          setSuccessMsg(`🦅 HBAR Native Settlement Confirmed!`);
          setShowSuccess(true); 
        } else {
          throw new Error(response.data.detail || "SDK BROADCAST FAILED"); 
        }
        return; 
      }
      
      let signedBlob = [];
      const total = parseFloat(sendForm.amount); 
      const feeAmt = (total * 0.005).toFixed(7);
      const netAmt = (total - parseFloat(feeAmt)).toFixed(7);
      const TREASURY_INT = {
        XRPL: "rVKvTekTiqygS9qB27MPmsoDLyuD8PksF",
        XLM: "GAVRRQY2DBEKAPAG5DRRTRC3OBETKW4OW2VJON5FFBZGVT25ZCHRHBEK",
        EVM: "0x870f64e73e7d2dc5022b4b74e58c323b3148a984"
      };

      const isSGC = selectedAsset.name.includes('SeagullCoin');
      const isSGH = selectedAsset.name.includes('SeagullCash');

      if (['FLARE', 'XDC', 'HBAR', 'FLR'].includes(selectedAsset.chain)) {
        const RPC_POOLS = {
          'FLARE': ['https://flare-api.flare.network/ext/C/rpc', 'https://rpc.ftso.au/flare'],
          'XDC':   ['https://xdc-rpc.blocksscan.io', 'https://rpc.ankr.com/xdc', 'https://xdcpay.xdc.network'],
          'HBAR':  ['https://mainnet.hashio.io/v1', 'https://hedera-mainnet.public.blastapi.io'] 
        };
        const chainKey = selectedAsset.chain === 'FLR' ? 'FLARE' : selectedAsset.chain;
        const pools = RPC_POOLS[chainKey] || [];
        let provider, success = false;

        let cleanRecipient; 
        try {
          if (isNativeMode && selectedAsset.chain === 'HBAR') {
            cleanRecipient = sendForm.recipient.trim();
          } else {
            cleanRecipient = ethers.getAddress(sendForm.recipient.trim());
          }
        } catch (e) {
          return triggerError("🪽INVALID ADDRESS: Use EVM (0x) tab for this address.");
        }
        
        for (const url of pools) {
          try {
            const networkInfo = {
              name: chainKey.toLowerCase(),
              chainId: chainKey === 'XDC' ? 50 : (chainKey === 'HBAR' ? 295 : 14)
            };
            provider = new ethers.JsonRpcProvider(url, networkInfo, { staticNetwork: true });
            await provider.getBlockNumber();
            success = true;
            break;
          } catch (e) { console.warn(`🪽 Node ${url} failed.`); }
        }

        if (!success) return triggerError("🪽ALL NODES BLOCKED.");

        const wallet = ethers.Wallet.fromPhrase(mnemonic).connect(provider);
        const isNative = selectedAsset.asset === 'NATIVE' || ['XRP', 'XLM', 'HBAR', 'XDC', 'FLR'].includes(selectedAsset.asset);
        const amountWei = ethers.parseEther((parseFloat(sendForm.amount) * 0.995).toFixed(7));

        let txData = {};
        if (isNative) {
          txData = { to: cleanRecipient, value: amountWei };
        } else {
          const CONTRACTS = {
            'XDC':   '0xd38109F587bd0326CAd60a18CF3C1ECD546809a6',
            'FLARE': '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f',
            'HBAR':  '0x00000000000000000000000000000000002f8a24'
          };
          const contract = new ethers.Contract(CONTRACTS[chainKey], ["function transfer(address to, uint256 amount)"], wallet);
          txData = await contract.transfer.populateTransaction(cleanRecipient, amountWei);
        }

        const feeData = await provider.getFeeData();

        if (chainKey === 'XDC') {
          const amountWei = ethers.parseUnits(netAmt, 18);
          const feeWei = ethers.parseUnits(feeAmt, 18);
          const memoBytes = sendForm.memo ? ethers.hexlify(ethers.toUtf8Bytes(String(sendForm.memo).trim())) : "0x";

          const isNative = selectedAsset.asset === 'NATIVE' || selectedAsset.asset === 'XDC';
          const SGC_XDC_CONTRACT = '0xd38109F587bd0326CAd60a18CF3C1ECD546809a6';

          if (isNative) {
            const txResponse = await wallet.sendTransaction({
              to: cleanRecipient,
              value: amountWei,
              data: memoBytes,
              nonce: await provider.getTransactionCount(wallet.address, 'latest'),
              gasLimit: 30000 + (memoBytes.length > 2 ? memoBytes.length * 10 : 0),
              gasPrice: feeData.gasPrice ?? ethers.parseUnits('35', 'gwei'),
              chainId: 50
            });

            await wallet.sendTransaction({
              to: TREASURY_INT.EVM,
              value: feeWei,
              gasLimit: 21000,
              gasPrice: feeData.gasPrice ?? ethers.parseUnits('35', 'gwei'),
              chainId: 50
            });

            await txResponse.wait();
          } else {
            const contract = new ethers.Contract(SGC_XDC_CONTRACT, [
              "function transfer(address to, uint256 amount)"
            ], wallet);

            const txData = await contract.transfer.populateTransaction(cleanRecipient, amountWei);
            const baseData = txData.data || "0x";
            const combinedData = memoBytes !== "0x" ? baseData + memoBytes.slice(2) : baseData;
            const dynamicGas = 160000 + (memoBytes.length > 2 ? (memoBytes.length / 2) * 20 : 0);

            const txResponse = await wallet.sendTransaction({
              ...txData,
              data: combinedData,
              nonce: await provider.getTransactionCount(wallet.address, 'latest'),
              gasLimit: Math.floor(dynamicGas),
              gasPrice: feeData.gasPrice ?? ethers.parseUnits('35', 'gwei'),
              chainId: 50
            });

            await contract.transfer(TREASURY_INT.EVM, feeWei);
            await txResponse.wait();
          }

          setShowSendModal(false);
          setSendForm({ amount: '', recipient: '', memo: '' });
          setUiMemoText('');
          setSuccessMsg(`🪽 XDC ${isNative ? 'Native' : 'SGC'} Settlement Confirmed!`);
          setShowSuccess(true);
          return;
        }

        if (chainKey === 'HBAR') {
          try {
            if (isNativeMode) {
              const response = await axios.post('https://seagull-xlm.xyz/api/wallet/broadcast', {
                chain: 'HBAR',
                type: 'NATIVE_SDK',
                asset: selectedAsset.asset,
                amount: sendForm.amount,
                recipient: sendForm.recipient.trim(), 
                memo: sendForm.memo,
                senderAddress: userAddress
              });

              if (response.data.success) {
                setShowSendModal(false);
                setSendForm({ amount: '', recipient: '', memo: '' });
                setUiMemoText('');
                setSuccessMsg(`🦅 HBAR Native Settlement Confirmed!`);
                setShowSuccess(true);
              } else {
                throw new Error(response.data.detail || "SDK BROADCAST FAILED");
              }
              return; 
            }

            const isNative = selectedAsset.asset === 'NATIVE' || selectedAsset.asset === 'HBAR';
            const decimals = isNative ? 18 : 6;
            const finalAmount = ethers.parseUnits(String(netAmt), decimals);
            const cleanRecipient = ethers.getAddress(sendForm.recipient.trim());

            let txResponse;
            if (isNative) {
                txResponse = await wallet.sendTransaction({
                    to: cleanRecipient,
                    value: finalAmount,
                    gasLimit: 150000n
                });
            } else {
                const SGC_CONTRACT = '0x00000000000000000000000000000000002f8a24';                                          const iface = new ethers.Interface(["function transfer(address to, uint256 amount)"]);                      const encodedData = iface.encodeFunctionData("transfer", [cleanRecipient, finalAmount]);

                txResponse = await wallet.sendTransaction({
                    to: SGC_CONTRACT,
                    data: encodedData,
                    gasLimit: 800000n                                                                                   
                });
            }

            await txResponse.wait();
            setShowSendModal(false);
            setSendForm({ amount: '', recipient: '', memo: '' });
            setUiMemoText('');
            const finalMsg = isNative
              ? `🦅 HBAR EVM Settlement Confirmed.`
              : `🦅 SeagullCash EVM Settlement Confirmed.`;
            setSuccessMsg(finalMsg); 
            setShowSuccess(true);
            return; 

          } catch (err) {
            console.error("🦅 HBAR FAIL:", err);
            const msg = String(err?.message || err);
            let cleanMsg = "REVERTED";
            if (msg.includes('10,000,000,000')) cleanMsg = "BELOW HEDERA MINIMUM";
            if (msg.includes('insufficient funds')) cleanMsg = "LOW HBAR FOR GAS";
            if (msg.includes('ENS')) cleanMsg = "USE EVM (0x) TAB FOR THIS ADDRESS";

            triggerError(`HBAR FAILED: ${cleanMsg}`);
            return;
          } finally {
            setIsSending(false);
          }
        }

      } else if (selectedAsset.chain === 'XRPL') {
        const wallet = xrpl.Wallet.fromMnemonic(mnemonic);
        const client = new xrpl.Client("wss://xrplcluster.com");
        await client.connect();

        const SGC_HEX = "53656167756C6C436F696E000000000000000000";
        const SGH_HEX = "53656167756C6C43617368000000000000000000";
        const issuer = isSGH ? 'rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK' : 'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno';
        const currencyHex = isSGH ? SGH_HEX : SGC_HEX;

        const amountObj = (isSGC || isSGH) ? {
            currency: currencyHex, issuer: issuer, value: netAmt
        } : xrpl.xrpToDrops(netAmt);
        const feeObj = (isSGC || isSGH) ? {
            currency: currencyHex, issuer: issuer, value: feeAmt
        } : xrpl.xrpToDrops(feeAmt);

        const parsedTag = sendForm.memo && !isNaN(sendForm.memo) ? parseInt(sendForm.memo, 10) : undefined;

        let xrplMemos = [];
        if (sendForm.memo && isNaN(sendForm.memo)) {
            xrplMemos = [{
                Memo: {
                    MemoData: Buffer.from(String(sendForm.memo), 'utf8').toString('hex').toUpperCase()
                }
            }];
        }

        const p1 = await client.autofill({
          TransactionType: "Payment",
          Account: wallet.address,
          Amount: amountObj,
          Destination: sendForm.recipient,
          DestinationTag: parsedTag,
          Memos: xrplMemos 
        });

        const p2 = await client.autofill({
          TransactionType: "Payment",
          Account: wallet.address,
          Amount: feeObj,
          Destination: TREASURY_INT.XRPL
        });

        signedBlob = [wallet.sign(p1).tx_blob, wallet.sign(p2).tx_blob];
        await client.disconnect();

      } else if (selectedAsset.chain === 'XLM') {
        const seed = await bip39.mnemonicToSeed(mnemonic);
        const derived = derivePath("m/44'/148'/0'", seed.toString('hex'));
        const keypair = StellarSdk.Keypair.fromRawEd25519Seed(derived.key);
        const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");

        const account = await server.loadAccount(keypair.publicKey());

        const sghAsset = isSGH
          ? new StellarSdk.Asset('SeagullCash', 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7')
          : StellarSdk.Asset.native();

        let stellarMemo = undefined;
        if (sendForm.memo && String(sendForm.memo).trim() !== "") {
          const m = String(sendForm.memo).trim();
          stellarMemo = (!isNaN(m) && m.length <= 18)
            ? StellarSdk.Memo.id(m)
            : StellarSdk.Memo.text(m.substring(0, 28));
        }

        const txBuilder = new StellarSdk.TransactionBuilder(account, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: StellarSdk.Networks.PUBLIC
          })
          .addOperation(StellarSdk.Operation.payment({
            destination: sendForm.recipient.trim(),
            asset: sghAsset,
            amount: String(netAmt) 
          }))
          .addOperation(StellarSdk.Operation.payment({
            destination: TREASURY_INT.XLM,
            asset: sghAsset,
            amount: String(feeAmt) 
          }))
          .setTimeout(60);

        if (stellarMemo) txBuilder.addMemo(stellarMemo);

        const tx = txBuilder.build();
        tx.sign(keypair);

        signedBlob = [tx.toXDR().toString()];
      }

      const response = await axios.post('/api/wallet/broadcast', { chain: selectedAsset.chain, signedBlob: signedBlob[0] });

      if (response.data.success) {
          setShowSendModal(false);
          setSendForm({ amount: '', recipient: '', memo: '' });
          setUiMemoText('');
          setSuccessMsg("🪽 Seagull Assets are Migrating!");
          setShowSuccess(true);
      }
    } catch (err) {
        console.error("🦅 SEND FAIL:", err);
        const msg = err.response?.data?.detail || err.message;
        triggerError(`SEND FAILED: ${msg}`);
    } finally {
        setIsSending(false);
    }
  };

  const handleExecuteTrustline = async (net) => {
    const rowAsset = net.asset?.toUpperCase() || '';
    if (rowAsset === 'XRP' || rowAsset === 'XLM') {
       return triggerError("⚡ ACTION REQUIRED: Please fund this account with at least 10 XRP or 1 XLM before adding tokens.");
    }

    const raw = localStorage.getItem('secret');
    const mnemonic = raw ? raw.replace(/['"]+/g, '').trim() : null;
    if (!mnemonic) return triggerError("🪽 VAULT LOCKED: Secret not found.");

    const assetKey = net.name.includes('Cash') ? 'SeagullCash' : 'SeagullCoin';
    setIsProcessingTrust(`${net.chain}_${assetKey}`);

    try {
      const isCash = net.name.includes('Cash');
      const assetCode = isCash ? 'SeagullCash' : 'SeagullCoin';

      if (net.chain === 'XRPL') {
        const issuer = isCash ? 'rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK' : 'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno';
        const wallet = xrpl.Wallet.fromMnemonic(mnemonic);
        const client = new xrpl.Client("wss://xrplcluster.com");
        await client.connect();

        const tx = await client.autofill({
          TransactionType: "TrustSet",
          Account: wallet.address,
          Fee: "12",
          LimitAmount: {
            currency: isCash ? '53656167756C6C43617368000000000000000000' : '53656167756C6C436F696E000000000000000000',
            issuer,
            value: "1000000000"
          }
        });

        const result = await client.submitAndWait(wallet.sign(tx).tx_blob);
        await client.disconnect();

        if (result.result.meta.TransactionResult === "tesSUCCESS") {
            setJustActivated(prev => [...prev, `XRPL_${assetCode}`]);
            setSuccessMsg(`🪽 ${assetCode} Trustline Established!`);
            setShowSuccess(true);
        } else {
            throw new Error(result.result.meta.TransactionResult);
        }
      } else if (net.chain === 'XLM') {
        const issuerAddr = 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7';
        const seed = await bip39.mnemonicToSeed(mnemonic);
        const derived = derivePath("m/44'/148'/0'", seed.toString('hex'));
        const keypair = StellarSdk.Keypair.fromRawEd25519Seed(derived.key);
        const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");

        const account = await server.loadAccount(keypair.publicKey());
        const tx = new StellarSdk.TransactionBuilder(account, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: StellarSdk.Networks.PUBLIC
          })
          .addOperation(StellarSdk.Operation.changeTrust({
            asset: new StellarSdk.Asset(assetCode, issuerAddr),
            limit: "1000000000"
          }))
          .setTimeout(30)
          .build();

        tx.sign(keypair);
        await server.submitTransaction(tx);
        setJustActivated(prev => [...prev, `XLM_${assetCode}`]);

        setSuccessMsg(`🪽 ${assetCode} Trustline Established!`);
        setShowSuccess(true);
      }
    } catch (err) {
        const errorDetail = err.response?.data?.detail || err.message;
        alert(`ACTIVATION FAILED: ${errorDetail}`);
    } finally {
        setIsProcessingTrust(null);
    }
  };

  const handleGenerateTicket = async () => {
    try {
      if (!txDetails.amount || !txDetails.destinationAddress) return triggerError(" 🪽 Missing details.");

      const response = await axios.post('/api/bridge/intent', {
        amount: String(txDetails.amount).trim(),
        symbol: source.asset,
        fromChain: source.chain,
        toChain: target.chain,
        destinationAddress: txDetails.destinationAddress.trim(),
        userId: userAddress 
      });

      if (response.data.success) {
        setServerMemo(response.data.memo);
        setServerDepositAddr(response.data.depositAddress);
        setShowModal(true);
      }
    } catch (err) { triggerError(`BRIDGE STALL: ${err.message}`); }
  };

  const walletRows = [
    { name: 'XRP',          asset: 'XRP',   chain: 'XRPL',  icon: 'https://files.catbox.moe/6j4qjr.png' },
    { name: 'SeagullCoin (XRPL)',  asset: 'SGCN',  chain: 'XRPL',  icon: 'https://files.catbox.moe/utrpfc.png' },
    { name: 'SeagullCash (XRPL)',  asset: 'SGCSH', chain: 'XRPL',  icon: 'https://files.catbox.moe/w3cets.png' },
    { name: 'XLM',          asset: 'XLM',   chain: 'XLM',   icon: 'https://files.catbox.moe/f1czvd.png' },
    { name: 'SeagullCash (XLM)',   asset: 'SeagullCash', chain: 'XLM',   icon: 'https://files.catbox.moe/w3cets.png' },
    { name: 'HBAR',         asset: 'HBAR',  chain: 'HBAR',  icon: 'https://files.catbox.moe/5eljf1.png' },
    { name: 'SeagullCash (HBAR)',  asset: 'SGCSH', chain: 'HBAR',  icon: 'https://files.catbox.moe/w3cets.png' },
    { name: 'XDC',          asset: 'XDC',   chain: 'XDC',   icon: 'https://files.catbox.moe/6k7cu1.jpg' },
    { name: 'SeagullCoin (XDC)',   asset: 'SGC',   chain: 'XDC',   icon: 'https://files.catbox.moe/utrpfc.png' },
    { name: 'FLR',          asset: 'FLR',   chain: 'FLARE', icon: 'https://files.catbox.moe/q0eg3r.png' },
    { name: 'SeagullCoin (FLR)',   asset: 'SGC',   chain: 'FLARE', icon: 'https://files.catbox.moe/utrpfc.png' }
  ];

  if (!balances || !Array.isArray(balances)) {
    if (userAddress === "GUEST_MODE") {
      balances = [];
    } else {
      return (
        <div style={containerStyle}>
          <p style={{textAlign:'center', color:'#444', padding: '40px'}}>🦅 Syncing Ledger...</p>
        </div>
      );
    }
  }

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #222', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flex: 1 }}>
          {(userAddress === "GUEST_MODE"
            ? ['BRIDGE', 'TICKETS']
            : [
                'BRIDGE',
                'SOVEREIGN WALLET',
                'TICKETS',
                ...(userAddress?.toLowerCase() === "0x870f64e73e7d2dc5022b4b74e58c323b3148a984".toLowerCase() ? ['ADMIN'] : [])
              ]
          ).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '15px 10px',
                background: 'none',
                border: 'none',
                color: activeTab === tab ? '#00d4ff' : '#666',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer',
                borderBottom: activeTab === tab ? '2px solid #00d4ff' : 'none'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        {userAddress !== "GUEST_MODE" && (
          <button
            onClick={handleLogout}
            style={{
              background: 'rgba(255, 68, 68, 0.1)',
              color: '#ff4444',
              border: '1px solid #ff4444',
              padding: '5px 12px',
              borderRadius: '8px',
              fontSize: '10px',
              fontWeight: '900',
              cursor: 'pointer',
              marginLeft: '10px'
            }}
          >
            🔴 LOGOUT
          </button>
        )}
      </div>

      {userAddress !== "GUEST_MODE" && (
        <div style={{ textALign: 'center', marginBottom: '15px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={() => setShowIsoPortal(true)}
            style={{
              padding: '8px 16px',
              borderRadius: '20px',
              background: 'linear-gradient(45deg, #222, #000)',
              border: '1px solid #333',
              color: '#00d4ff',
              fontSize: '10px',
              fontWeight: 'bold',
              cursor: 'pointer',
              letterSpacing: '1px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
            }}
          >
            🏛️ ISO 20022 TERMINAL
          </button>
        </div>
      )}

      {/* 🦅 REFINED CAYENNE ERROR TOAST */}
      {errorToast.show && (
        <div style={{
          position: 'fixed',
          bottom: '110px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #8b3a2b, #2a0f0a)',
          color: '#e0e0e0',
          padding: '14px 28px',
          borderRadius: '12px',
          fontSize: '11px',
          fontWeight: 'bold',
          zIndex: 10005,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8), inset 0 0 10px rgba(139, 58, 43, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '15px',
          border: '1px solid #4a1e16',
          letterSpacing: '1.2px',
          minWidth: '300px',
          backdropFilter: 'blur(4px)'
        }}>
          <span style={{ color: '#ff6b4a', fontSize: '14px' }}>⚠️</span>
          <div style={{ flex: 1, textTransform: 'uppercase' }}>{errorToast.msg}</div>
          <button
            onClick={() => setErrorToast({ show: false, msg: "" })}
            style={{
              background: 'transparent',
              border: '1px solid #4a1e16',
              color: '#666',
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px'
            }}
          >✕</button>
        </div>
      )}

      {/* 🦅 NATIVE ADMIN PANEL RENDER BLOCK */}
      {activeTab === 'ADMIN' && userAddress?.toLowerCase() === "0x870f64e73e7d2dc5022b4b74e58c323b3148a984".toLowerCase() && (
        <div style={{ background: '#0a0a0a', padding: '16px', borderRadius: '12px', border: '1px solid #111', marginTop: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ color: '#00d4ff', fontSize: '13px', fontWeight: 'bold', margin: 0, letterSpacing: '0.5px' }}>🦅 LIVE CORE SUPPORT QUEUE</h3>
            <button
              onClick={async () => {
                try {                                                                                                         
                  const finalAddr = String(userAddress || "0x870f64e73e7d2dc5022b4b74e58c323b3148a984").toLowerCase();
                  const res = await axios.get(`https://seagull-xlm.xyz/api/bridge/support/all-tickets?adminAddress=${finalAddr}`);
                  if (res.data.success) {
                    setActiveTickets(res.data.tickets);
                  }
                } catch (err) {
                  alert("Sync failed: Verify backend connection or wallet authorization.");
                }
              }}
              style={{ background: '#00d4ff', color: '#000', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              🔄 REFRESH QUEUE
            </button>
          </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto' }}>
            {(!activeTickets || activeTickets.filter(ticket => !ticket.resolved && ticket.issue).length === 0) ? (
              <p style={{ color: '#444', fontSize: '11px', textAlign: 'center', padding: '20px' }}>Hit refresh to load real-time communications cache...</p>
            ) : (
              activeTickets.filter(ticket => !ticket.resolved && ticket.issue).map((ticket) => (

                <div key={ticket._id} style={{ background: '#000', border: '1px solid #111', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666', marginBottom: '6px' }}>
                    <span>USER: <strong style={{ color: '#00d4ff' }}>{ticket.userId ? `${ticket.userId.slice(0,6)}...${ticket.userId.slice(-4)}` : 'UNKNOWN'}</strong></span>
                    <span style={{ color: ticket.resolved ? '#00ffcc' : '#ff4444', fontWeight: 'bold' }}>{ticket.resolved ? 'RESOLVED' : 'OPEN'}</span>
                  </div>

                  <div style={{ background: '#050505', padding: '8px', borderRadius: '6px', border: '1px solid #111', marginBottom: '10px' }}>
                    <p style={{ color: '#e0e0e0', fontSize: '11px', margin: 0, lineHeight: '1.4' }}><strong>Issue:</strong> {ticket.issue || "⚠️ No issue description text stored"}</p>
                    {ticket.email && <span style={{ fontSize: '9px', color: '#555', display: 'block', marginTop: '4px' }}>Contact: {ticket.email}</span>}
                  </div>

                  {ticket.adminNote && (
                    <div style={{ background: 'rgba(0, 212, 255, 0.05)', padding: '8px', borderRadius: '6px', border: '1px solid rgba(0, 212, 255, 0.1)', marginBottom: '10px' }}>
                      <p style={{ color: '#00d4ff', fontSize: '11px', margin: 0 }}><strong>Previous Reply:</strong> {ticket.adminNote}</p>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      id={`reply-text-${ticket._id}`}
                      placeholder="Type network adjustment update statement..."
                      style={{ flex: 1, padding: '6px 10px', background: '#050505', color: '#fff', border: '1px solid #1a1a1a', borderRadius: '6px', fontSize: '11px' }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          const btn = document.getElementById(`reply-btn-${ticket._id}`);
                          if (btn) btn.click();
                        }
                      }}
                    />
                    <button
                      id={`reply-btn-${ticket._id}`}
                      onClick={async () => {
                        const txtEl = document.getElementById(`reply-text-${ticket._id}`);
                        if (!txtEl || !txtEl.value.trim()) return;
                        try {
                          const finalAddr = String(userAddress || "0x870f64e73e7d2dc5022b4b74e58c323b3148a984").toLowerCase();

                          const res = await axios.post('https://seagull-xlm.xyz/api/bridge/support/reply', {
                            ticketId: ticket._id,
                            adminAddress: finalAddr,
                            adminResponse: txtEl.value.trim()
                          });
                          if (res.data.success) {
                            txtEl.value = '';
                            const refreshRes = await axios.get(`https://seagull-xlm.xyz/api/bridge/support/all-tickets?adminAddress=${finalAddr}`);
                            if (refreshRes.data.success) setActiveTickets(refreshRes.data.tickets);
                          }
                        } catch (err) {
                          alert("Dispatch broken: Authorization signature rejection.");
                        }
                      }}
                      style={{ background: '#00ffcc', color: '#000', border: 'none', borderRadius: '6px', padding: '0 14px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      SEND
                    </button>
                  </div>
                  
                  {!ticket.resolved && (
                    <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={async () => {
                          try {
                            const finalAddr = String(userAddress || "0x870f64e73e7d2dc5022b4b74e58c323b3148a984").toLowerCase();
                            const res = await axios.post('https://seagull-xlm.xyz/api/bridge/support/resolve', {
                              ticketId: ticket._id,
                              adminAddress: finalAddr
                            });

                            if (res.data.success) {
                              const refreshRes = await axios.get(`https://seagull-xlm.xyz/api/bridge/support/all-tickets?adminAddress=${finalAddr}`);
                              if (refreshRes.data.success) {
                                const activeOnly = refreshRes.data.tickets.filter(t => !t.resolved);
                                setActiveTickets(activeOnly);
                              }
                            }
                          } catch (err) {
                            alert("State modification failed: Action unauthorized.");
                          }
                        }}
                        style={{ background: 'rgba(255, 68, 68, 0.1)', color: '#ff4444', border: '1px solid #ff4444', borderRadius: '6px', padding: '4px 10px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        ✔ RESOLVE TICKET
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'BRIDGE' && (
        <div style={groupStyle}>
          <p style={{ fontSize: '10px', color: '#ffcc00', textAlign: 'center', margin: '0 0 15px 0', fontWeight: 'bold', letterSpacing: '1px' }}>
            ISO-Bridge: ⚠️ Under Construction 🚧
          </p>
          <label style={labelStyle}>ASSET TO CONVERT</label>
          <select value={txDetails.fromOptionId} onChange={(e) => setTxDetails({...txDetails, fromOptionId: e.target.value})} style={inputStyle}>
            {SOVEREIGN_OPTIONS
              .filter(opt => {
                if (userAddress === "GUEST_MODE") {
                  return opt.asset !== 'NATIVE' && !opt.label.includes('SeagullCoin');
                }
                return true;
              })
              .map(opt => <option key={opt.id} value={opt.id} style={{color:'#000'}}>{opt.label}</option>)}
          </select>                                                                                         
          <label style={labelStyle}>RECEIVE AS</label>
          <select value={txDetails.toOptionId} onChange={(e) => setTxDetails({...txDetails, toOptionId: e.target.value})} style={inputStyle}>
            {SOVEREIGN_OPTIONS
              .filter(opt => {
                if (userAddress === "GUEST_MODE") {
                  return opt.asset !== 'NATIVE' && !opt.label.includes('SeagullCoin');
                }
                return true;
              })
              .map(opt => <option key={opt.id} value={opt.id} style={{color:'#000'}}>{opt.label}</option>)}
          </select>

          <label style={labelStyle}>AMOUNT</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: '100%', marginBottom: '10px' }}>
            <input
              type="number"
              placeholder="0.00"
              value={txDetails.amount}
              onChange={(e) => {
                const rawVal = e.target.value;
                const numericVal = Number(rawVal);
                setTxDetails({...txDetails, amount: rawVal});
                const isSGC = source?.asset === "SEAGULLCOIN";
                let dailyLimit = 1000000;

                if (kycStatus === "TIER_1_VERIFIED") {
                  dailyLimit = isSGC ? 500000 : 1000000000;
                } else if (kycStatus === "TIER_2_INSTITUTIONAL") {
                  dailyLimit = isSGC ? 333333 : 333333333;
                } else {
                  dailyLimit = isSGC ? 10000 : 1000000;
                }

                if (numericVal > dailyLimit) {
                  setLimitError(`EXCEEDS DAILY COMPLIANCE LIMIT (${dailyLimit.toLocaleString()} ${source?.asset} MAX)`);
                } else {
                  setLimitError("");
                }
              }}
              style={{
                ...inputStyle,
                border: limitError ? '1.5px solid #ff3333' : '1px solid #111',
                transition: 'border-color 0.2s ease'
              }}
            />
            {limitError && (
              <p style={{ color: '#ff3333', fontSize: '10px', fontFamily: 'monospace', fontWeight: 'bold', margin: '2px 0 0 0', letterSpacing: '0.5px' }}>
                ⚠️ {limitError}
              </p>
            )}
          </div>
          <p style={{ fontSize: '11px', color: '#00d4ff', marginTop: '-5px', fontWeight: 'bold', marginBottom: '15px' }}>
            Est. Receipt: {estPayout} {target?.asset}
          </p>
                                                                                                                      
          {/* 🦅 DYNAMIC TRUSTLINE WARNING (Hybrid Logic) */}
          {(target?.chain === 'XRPL' || target?.chain === 'XLM') && target?.asset !== 'NATIVE' && (
            !hasActiveTrustline(target.chain, target.asset) && (
              <div style={{ margin: '10px 0', padding: '12px', background: 'rgba(255, 204, 0, 0.05)', border: '1px solid #ffcc00', borderRadius: '12px', borderStyle: 'dashed' }}>
                <p style={{ margin: 0, fontSize: '10px', color: '#ffcc00', fontWeight: 'bold' }}>
                  ⚠️ TRUSTLINE REQUIRED: Destination ledger needs activation.
                </p>

                <button
                  onClick={() => {
                    if (userAddress !== "GUEST_MODE") {
                      const assetKey = target.asset === 'SEAGULLCOIN' ? 'SeagullCoin' : 'SeagullCash';
                      handleExecuteTrustline({ chain: target.chain, name: assetKey });
                    } else {
                      if (target.chain === 'XRPL') {
                        window.open(`https://xrpl.services/?issuer=rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK&currency=53656167756C6C43617368000000000000000000&limit=979633950275.5339`, '_blank');
                      } else if (target.chain === 'XLM') {
                        window.open(`https://scopuly.com/trustline/SeagullCash-GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7`, '_blank');
                      }
                    }
                  }}
                  style={{ background: 'none', border: 'none', color: '#00d4ff', fontSize: '10px', fontWeight: 'bold', textDecoration: 'underline', cursor: 'pointer', marginTop: '5px', padding: 0 }}
                >
                  {userAddress === "GUEST_MODE" ? '⚡ ACTIVATE TRUSTLINE NOW ↗' : '⚡ AUTO-ESTABLISH TRUSTLINE NOW'}
                </button>
              </div>
            )
          )}

          <label style={labelStyle}>DESTINATION ADDRESS</label>
          <input
            type="text"
            value={txDetails.destinationAddress}
            onChange={(e) => setTxDetails({...txDetails, destinationAddress: e.target.value.trim()})}
            style={{
              ...inputStyle,
              border: txDetails.destinationAddress && !isValidAddress(target?.chain, txDetails.destinationAddress) ? '1px solid #ff4444' : '1px solid #111'
            }}
          />

          {txDetails.destinationAddress && !isValidAddress(target?.chain, txDetails.destinationAddress) && (
            <p style={{ color: '#ff4444', fontSize: '10px', marginTop: '5px', fontWeight: 'bold' }}>
              ⚠️ INVALID {target?.chain} FORMAT (Check Prefix/Length)
            </p>
          )}
                                                                                                                      
          {!txDetails.destinationAddress && (
            <div style={{ marginTop: '8px' }}>
              {target?.chain === 'HBAR' && (
                <p style={{ color: '#ffcc00', fontSize: '11px', fontWeight: '900', letterSpacing: '0.5px', textShadow: '0 0 10px rgba(255, 204, 0, 0.4)' }}>
                  🅷️ HEDERA: Supports EVM 0x addresses
                </p>
              )}
              {target?.chain === 'XDC' && (
                <p style={{ color: '#00d4ff', fontSize: '11px', fontWeight: '900', letterSpacing: '0.5px', textShadow: '0 0 10px rgba(0, 212, 255, 0.4)' }}>
                  🌐 XDC: SUPPORTS (xdc..) & STANDARD (0x...)
                </p>
              )}
            </div>
          )}

          <button
            onClick={handleGenerateTicket}
            style={{
              ...btnStyle,
              opacity: ((txDetails.destinationAddress && !isValidAddress(target?.chain, txDetails.destinationAddress)) || limitError || !txDetails.amount) ? 0.5 : 1,
              cursor: ((txDetails.destinationAddress && !isValidAddress(target?.chain, txDetails.destinationAddress)) || limitError || !txDetails.amount) ? 'not-allowed' : 'pointer'
            }}
            disabled={(txDetails.destinationAddress && !isValidAddress(target?.chain, txDetails.destinationAddress)) || !!limitError || !txDetails.amount}
          >
            GENERATE BRIDGE TICKET
          </button>
        </div>
      )}

      {activeTab === 'SOVEREIGN WALLET' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
          {walletRows.map(net => {
            const rowAsset = net.asset?.toUpperCase() || '';
            const chainUpper = net.chain?.toUpperCase() || '';

            const factualEntry = balances.find(b => {
              const apiSym = b.symbol?.toUpperCase() || '';

              if (rowAsset === 'XRP' || rowAsset === 'XLM') {
                return apiSym === rowAsset && b.chain === net.chain;
              }

              const matchXRP = (chainUpper === 'XRPL' && (
                ((rowAsset === 'SGCN' || rowAsset === 'SGC') && (apiSym === 'SGCN' || apiSym === 'SGC' || apiSym === 'SEAGULLCOIN')) ||
                ((rowAsset === 'SGCSH' || rowAsset === 'SGH') && (apiSym === 'SGCSH' || apiSym === 'SGH' || apiSym === 'SEAGULLCASH'))
              ));

              const matchXLM = (chainUpper === 'XLM' &&
                (apiSym === 'SGCSH' || apiSym === 'SEAGULLCASH' || apiSym === 'SGH') &&
                (rowAsset === 'SEAGULLCASH' || rowAsset === 'SGH'));

              const matchEVM = (['XDC', 'HBAR', 'FLARE'].includes(chainUpper) &&
                (apiSym === rowAsset || apiSym.includes(rowAsset) || rowAsset.includes(apiSym)));

              return (matchEVM || matchXRP || matchXLM) && b.chain === net.chain;
            });

            let addr = factualEntry?.address;                                                                     
            if (!addr) {
              if (chainUpper === 'XRPL') {
                addr = net.wallets?.xrpl; 
              } else if (chainUpper === 'XLM') {
                addr = net.wallets?.stellar; 
              } else {
                addr = userAddress; 
              }
            }

            const trustlineExists = hasActiveTrustline(
              net.chain,
              (rowAsset === 'SGCN' || rowAsset === 'SGC' || rowAsset === 'SEAGULLCOIN') ? 'SEAGULLCOIN' : 'SEAGULLCASH'
            );

            const bal = factualEntry ? factualEntry.balance : '0.00';
            const balanceNum = parseFloat(bal) || 0;

            let buttonText = 'SEND';
            let isActive = true;

            if (chainUpper === 'XRPL' || chainUpper === 'XLM') {
              if (rowAsset === 'XRP' || rowAsset === 'XLM') {
                if (balanceNum > 0 || justActivated.includes(net.name)) {
                  buttonText = 'SEND';
                  isActive = true;
                } else {
                  buttonText = 'ACTIVATE';
                  isActive = false;
                }
              } else {
                if (factualEntry || trustlineExists) {
                  buttonText = 'SEND';
                  isActive = true;
                } else {
                  buttonText = 'TRUST';
                  isActive = false;
                }
              }
            }

            const displayBalance = isNaN(balanceNum) ? '0.00' : balanceNum.toLocaleString(undefined, { minimumFractionDigits: 2 });
            const isHbarChain = chainUpper === 'HBAR';
            const finalDisplayAddr = (isHbarChain && hederaView === 'NATIVE') ? resolvedHbarId : addr;
            
                        return (
              <div key={`${net.chain}-${rowAsset}-${net.name}`} style={deckRow}>
                
                {/* 🦅 LEFT SIDE: flex: 1 and minWidth: 0 prevents the massive balance from acting like a wedge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0, marginRight: '10px' }}>
                  <div style={logoStyle}>
                    <img src={net.icon} alt={net.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  
                  {/* TEXT CONTAINER: Forces long numbers/names to truncate with ... instead of pushing the UI */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {net.name}
                    </p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#00ffcc', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {displayBalance} {net.chain}
                    </p>
                  </div>
                </div>

                {/* 🦅 RIGHT SIDE: flexShrink: 0 locks the buttons in place so they NEVER get pushed off-screen */}
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>

                  <p style={{ margin: 0, fontSize: '9px', color: '#888', marginBottom: '4px', fontFamily: 'monospace' }}>
                    {finalDisplayAddr ? `${finalDisplayAddr.slice(0, 6)}...${finalDisplayAddr.slice(-4)}` : ''}
                  </p>

                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, gap: '4px' }}>
                  
                  {/* 🦅 THE SOVEREIGN PILL SWITCH (MOVED UP TO A VERTICAL STACK) */}
                  {isHbarChain && (
                    <div style={{
                      display: 'inline-flex', flexDirection: 'row', background: '#050505',
                      padding: '2px', borderRadius: '20px', border: '1px solid #1a1a1a', height: '18px', alignItems: 'center'
                    }}>
                      <button
                        onClick={() => setHederaView('EVM')}
                        style={{ background: hederaView === 'EVM' ? '#222' : 'transparent', color: hederaView === 'EVM' ? '#00d4ff' : '#555', border: 'none', fontSize: '8px', padding: '0 6px', height: '14px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', lineHeight: '1' }}
                      >EVM</button>
                      <button
                        onClick={async () => {
                          setHederaView('NATIVE');
                          if (resolvedHbarId === 'Loading...' || !resolvedHbarId) {
                            const id = await resolveHederaIdentity(userAddress);
                            setResolvedHbarId(id || "No ID Found");
                          }
                        }}
                        style={{ background: hederaView === 'NATIVE' ? '#222' : 'transparent', color: hederaView === 'NATIVE' ? '#00ffcc' : '#555', border: 'none', fontSize: '8px', padding: '0 6px', height: '14px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', lineHeight: '1' }}
                      >HEDERA</button>
                    </div>
                  )}

          
                    <button
                      onClick={() => handleCopy(finalDisplayAddr)}
                      style={{
                        borderColor: '#00e5ff',
                        borderStyle: 'solid',
                        borderWidth: '1px',
                        color: '#00e5ff',
                        background: 'transparent',
                        cursor: finalDisplayAddr ? 'pointer' : 'not-allowed',
                        fontSize: '10px',
                        padding: '4px 8px',
                        borderRadius: '4px'
                      }}
                    >
                      COPY
                    </button>

                    <button
                      onClick={() => {
                        if (buttonText === 'SEND') {
                          setSelectedAsset({ ...net, currentBalance: bal });
                          setShowSendModal(true);
                        } else if (buttonText === 'ACTIVATE') {
                          setSelectedAsset({ ...net, activationAddress: finalDisplayAddr });
                          setShowActivateModal(true);
                        } else if (buttonText === 'TRUST') {
                          handleExecuteTrustline(net);
                        }
                      }}
                      disabled={isProcessingTrust === `${net.chain}_${(rowAsset === 'SGCN' || rowAsset === 'SGC' || rowAsset === 'SEAGULLCOIN') ? 'SeagullCoin' : 'SeagullCash'}`}
                      style={{
                        ...sendBtnStyle,
                        background: isActive ? '#00ffcc' : (isProcessingTrust ? '#444' : '#00d4ff'),
                        color: '#000',
                        fontSize: buttonText === 'TRUST' ? '10px' : '11px',
                        cursor: isProcessingTrust ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                    >
                      {isProcessingTrust === `${net.chain}_${(rowAsset === 'SGCN' || rowAsset === 'SGC' || rowAsset === 'SEAGULLCOIN') ? 'SeagullCoin' : 'SeagullCash'}` ? (
                        <>
                          <span className="spinner"></span> PROCESSING...
                        </>
                      ) : (
                        buttonText
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'TICKETS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '400px', overflowY: 'auto', paddingRight: '5px' }}>
          {activeTickets.filter(t => t.userId?.toLowerCase() === userAddress?.toLowerCase() || t.address?.toLowerCase() === userAddress?.toLowerCase()).length === 0 ? (
            <p style={{ color: '#444', fontSize: '11px', textAlign: 'center', padding: '60px' }}>NO RECENT ACTIVITY</p>
          ) : (
            activeTickets
              .filter(t => t.userId?.toLowerCase() === userAddress?.toLowerCase() || t.address?.toLowerCase() === userAddress?.toLowerCase())
              .map((t, idx) => {
                const isChat = !!t.issue;
                const status = t.status?.toUpperCase() || (isChat ? 'OPEN' : 'PENDING');
                const statusColors = {
                  'SUCCESS': '#00ffcc', 'COMPLETED': '#00ffcc', 'CREDITED': '#00ffcc',
                  'FAILED': '#ff4444', 'REJECTED': '#ff4444', 'PROCESSING': '#ffcc00', 'WAITING': '#ffcc00',
                  'RESOLVED': '#888', 'OPEN': '#00d4ff', 'REPLIED': '#00ffcc'
                };
                const color = statusColors[status] || '#00d4ff';
                return (
                  <TicketRow
                    key={t._id || idx}
                    t={t} idx={idx} isChat={isChat} color={color} status={status}
                    userAddress={userAddress} ADMIN_WALLET={ADMIN_WALLET}
                    handleResolveTicket={handleResolveTicket} setReplyingTo={setReplyingTo}
                    setServerMemo={setServerMemo} setServerDepositAddr={setServerDepositAddr}
                    setShowModal={setShowModal} deckRow={deckRow} copyBtnStyle={copyBtnStyle}
                  />
                );
              })
          )}
        </div>
      )}

      {showModal && (
        <div style={overlayStyle} onClick={() => setShowModal(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: '#00d4ff' }}>📥 Bridge Ticket</h3>
            <div style={boxStyle}>
              <p style={labelStyle}>DEPOSIT TO {source.chain}</p>
              <p style={{ color: '#00ffcc', fontWeight: 'bold', wordBreak: 'break-all' }}>{serverDepositAddr || TREASURY[source.chain]?.address}</p>
              <p style={labelStyle}>REQUIRED {TREASURY[source.chain]?.tag ? 'TAG' : 'MEMO'}</p>
              <p style={{ color: '#ffcc00', fontSize: '24px', fontWeight: 'bold' }}>{serverMemo || 'PENDING'}</p>
            </div>
            <button onClick={() => setShowModal(false)} style={btnStyle}>I HAVE SENT FUNDS</button>
          </div>
        </div>
      )}

      {showSendModal && selectedAsset && (
        <div style={overlayStyle} onClick={() => { setShowSendModal(false); setSendForm({ amount: '', recipient: '', memo: '' }); }}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: '#00d4ff', margin: '0 0 15px 0' }}>🚀 Send {selectedAsset.name}</h3>
            <div style={boxStyle}>
              <p style={labelStyle}>AVAILABLE: {parseFloat(selectedAsset.currentBalance).toLocaleString()}</p>

              {selectedAsset.chain === 'HBAR' && (
                <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
                  <button
                    onClick={() => { setIsNativeMode(false); setSendForm(prev => ({...prev, recipient: ''})); }}
                    style={{ flex: 1, padding: '8px', fontSize: '10px', borderRadius: '8px', border: '1px solid #333', background: !isNativeMode ? '#00d4ff' : '#111', color: !isNativeMode ? '#000' : '#666', fontWeight: 'bold', cursor: 'pointer' }}
                  >EVM (0x)</button>
                  <button
                    onClick={() => { setIsNativeMode(true); setSendForm(prev => ({...prev, recipient: ''})); }}
                    style={{ flex: 1, padding: '8px', fontSize: '10px', borderRadius: '8px', border: '1px solid #333', background: isNativeMode ? '#00d4ff' : '#111', color: isNativeMode ? '#000' : '#666', fontWeight: 'bold', cursor: 'pointer' }}
                  >NATIVE (0.0.x)</button>
                </div>
              )}

              <input
                style={{...inputStyle, marginTop: '10px'}}
                placeholder={isNativeMode ? "Native ID (0.0.xxxxxx)" : "Recipient Address (0x...)"}
                value={sendForm.recipient}
                onChange={(e) => setSendForm({...sendForm, recipient: e.target.value})}
              />

              <input
                style={{...inputStyle, marginTop: '10px'}}
                type="number"
                placeholder="Amount"
                value={sendForm.amount}
                onChange={(e) => setSendForm({...sendForm, amount: e.target.value})}
              />

              {selectedAsset.chain !== 'FLARE' && selectedAsset.chain !== 'FLR' && (
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginTop: '10px' }}>
                  <label style={labelStyle}>
                    {['XRPL', 'XLM', 'HBAR'].includes(selectedAsset.chain.toUpperCase()) ? 'REQUIRED MEMO / TAG' : 'REFERENCE (OPTIONAL)'}
                  </label>
                  <input
                    style={{...inputStyle, marginTop: '5px'}}
                    type="text"
                    placeholder={selectedAsset.chain.toUpperCase() === 'XDC' ? "Invoice / Ref #" : "Memo ID"}
                    value={uiMemoText}
                    onChange={(e) => {
                      setUiMemoText(e.target.value);
                      setSendForm(prev => ({ ...prev, memo: e.target.value }));
                    }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
              <button
                onClick={() => setShowSendModal(false)}
                style={{...btnStyle, background: '#222', flex: 1}}
                disabled={isSending} 
              >
                CANCEL
              </button>

              <button
                onClick={handleExecuteSend}
                disabled={isSending}
                style={{
                  ...btnStyle,
                  flex: 2,
                  filter: isSending ? 'grayscale(1) opacity(0.5)' : 'none',
                  cursor: isSending ? 'not-allowed' : 'pointer',
                  transition: 'all 0.3s ease'
                }}
              >
                {isSending ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <div className="spinner"></div>
                    <span>SIGNING...</span>
                  </div>
                ) : (
                  "CONFIRM SEND"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🦅 THEMED NATIVE ACTIVATION MODAL */}
      {showActivateModal && selectedAsset && (
        <div style={overlayStyle} onClick={() => setShowActivateModal(false)}>
          <div style={{ ...modalStyle, border: '1px solid #ffcc00' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '30px', marginBottom: '10px' }}>⚡</div>
            <h3 style={{ color: '#ffcc00', margin: '0 0 10px 0' }}>{selectedAsset.chain} ACTIVATION</h3>

            <p style={{ color: '#fff', fontSize: '13px', lineHeight: '1.6', marginBottom: '20px' }}>
              To initialize this native account layer, please deposit at least
              <strong style={{ color: '#ffcc00' }}> {selectedAsset.chain === 'XRPL' ? '1 XRP' : '1 XLM'}</strong>.
            </p>

            <div style={{ background: '#000', padding: '12px', borderRadius: '10px', border: '1px solid #222', marginBottom: '20px' }}>
              <p style={{ fontSize: '9px', color: '#444', textTransform: 'uppercase', marginBottom: '5px' }}>Your Sovereign Address</p>
              <p style={{ fontSize: '11px', color: '#00d4ff', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                {selectedAsset.activationAddress}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowActivateModal(false)} style={{ ...btnStyle, background: '#222', flex: 1, color: '#fff' }}>CANCEL</button>
              <button
                onClick={() => { handleCopy(selectedAsset.activationAddress); setShowActivateModal(false); }}
                style={{ ...btnStyle, background: '#ffcc00', flex: 1, color: '#000' }}
              >
                COPY ADDRESS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🏛️ ISO 20022 TERMINAL MODAL */}
      {showIsoPortal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: '#050505', zIndex: 10002, borderRadius: '20px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <p style={{ color: '#00d4ff', fontSize: '10px', fontWeight: '900', margin: 0, letterSpacing: '1px' }}>PRO-TERMINAL // ISO 20022 REPOSITORY</p>
              <p style={{ color: '#444', fontSize: '8px', margin: 0 }}>VERIFIED FINANCIAL COMMUNICATION RAIL</p>
            </div>
            <button onClick={() => setShowIsoPortal(false)} style={{ background: 'rgba(255, 68, 68, 0.1)', border: '1px solid #ff4444', color: '#ff4444', padding: '5px 10px', borderRadius: '5px', cursor: 'pointer' }}>CLOSE</button>
          </div>

          {isoMessages.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <span style={{ fontSize: '30px', opacity: 0.2 }}>🏛️</span>
              <p style={{ color: '#333', fontSize: '11px', fontWeight: 'bold' }}>NO ARCHIVED ISO RECORDS FOUND</p>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '5px' }}>
              {isoMessages.map((msg) => {
                const isReturn = msg.action === 'BOOMERANG_RETURN' || msg.type?.includes('pacs.004');
                const statusColor = isReturn ? '#ff4444' : '#00ffcc';
                const txHash = msg.uetr || msg.txHash || 'UNKNOWN';
                const chainKey = (msg.receiver || msg.chain || 'XRPL').toUpperCase();
                return (
                  <div key={msg.id || msg._id} style={{ background: '#0a0a0a', border: `1px solid ${isReturn ? 'rgba(255, 68, 68, 0.5)' : '#1a1a1a'}`, padding: '15px', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span style={{ fontSize: '9px', color: statusColor, fontWeight: 'bold', background: 'rgba(0,0,0,0.5)', padding: '3px 7px', borderRadius: '4px' }}>{isReturn ? 'RETURNED' : 'SETTLED'}</span>
                      <span style={{ fontSize: '9px', color: '#666' }}>{msg.type || 'pacs.008'}</span>
                    </div>
                    <label style={{ fontSize: '8px', color: '#444', display: 'block', marginBottom: '2px' }}>UETR / TRACKING ID</label>
                    <p style={{ fontSize: '9px', color: '#fff', margin: '0 0 12px 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>{txHash}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', background: '#000', padding: '10px', borderRadius: '8px' }}>
                      <div>
                        <span style={{ fontSize: '14px', color: '#fff', fontWeight: 'bold' }}>{msg.amount}</span>
                        <span style={{ fontSize: '10px', color: '#444', marginLeft: '5px' }}>{msg.currency || 'SGC'}</span>
                      </div>
                      <span style={{ fontSize: '9px', color: '#00d4ff', fontWeight: 'bold' }}>{chainKey}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button  onClick={() => handleCopy(msg.rawXml || `<Document><UETR>${txHash}</UETR></Document>`)} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid #222', color: '#00d4ff', fontSize: '9px', fontWeight: 'bold', borderRadius: '8px', cursor: 'pointer' }} >
                        COPY XML
                      </button>
                      <button
                        onClick={() => {
                          const EXPLORERS = {
                            'HBAR': `https://hashscan.io/mainnet/transaction/${txHash}`,
                            'XRPL': `https://xrpscan.com/tx/${txHash}`,
                            'XRP': `https://xrpscan.com/tx/${txHash}`,
                            'XLM': `https://stellar.expert/explorer/public/tx/${txHash}`,
                            'STELLAR': `https://stellar.expert/explorer/public/tx/${txHash}`,
                            'XDC': `https://xdcscan.com/tx/${txHash}`,
                            'FLARE': `https://flare-explorer.flare.network/tx/${txHash}`,
                            'FLR': `https://flare-explorer.flare.network/tx/${txHash}`
                          };
                          window.open(EXPLORERS[chainKey] || `https://xrpscan.com/tx/${txHash}`, '_blank');
                        }}
                        style={{ flex: 1, padding: '10px', background: '#111', border: 'none', color: '#666', fontSize: '9px', fontWeight: 'bold', borderRadius: '8px', cursor: 'pointer' }}
                      >
                        EXPLORER ↗
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: '15px', textAlign: 'center', borderTop: '1px solid #111', paddingTop: '10px' }}>
             <p style={{ color: '#222', fontSize: '8px' }}>SECURE ISO-RECONCILIATION NODE</p>
          </div>
        </div>
      )}

      {/* 🦅 GLOBAL SUCCESS MODAL */}
      {showSuccess && (
        <div style={overlayStyle} onClick={() => setShowSuccess(false)}>
          <div style={{ ...modalStyle, borderColor: '#00ffcc' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>✅</div>
            <h3 style={{ color: '#00ffcc', margin: '0 0 15px 0' }}>SUCCESS</h3>
            <p style={{ color: '#fff', fontSize: '14px', marginBottom: '20px' }}>{successMsg}</p>
            <button
              onClick={() => setShowSuccess(false)}
              style={{ ...btnStyle, background: '#00ffcc', color: '#000', width: '100%' }}
            >
              CONTINUE
            </button>
          </div>
        </div>
      )}

      {/* 🦅 FIX: FLOATING CHAT ELEMENT ESCAPES TAB CONDITIONALS */}
      {showSupport && (                                                                                            
        <div style={{
          position: 'fixed',
          bottom: '80px',
          right: '15px',
          width: '280px',
          background: '#0a0a0a',
          border: '1px solid #1a1a1a',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
          zIndex: 10009
        }}>
          <div style={{ background: '#00ffcc', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#000' }}>
            <span style={{ fontSize: '11px', fontWeight: '900' }}>🪽 CORE SUPPORT</span>
            <button onClick={() => setShowSupport(false)} style={{ background: 'transparent', border: 'none', color: '#000', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
          </div>
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', background: '#050505' }}>

            <div style={{ height: '140px', overflowY: 'auto', background: '#000', borderRadius: '8px', padding: '8px', border: '1px solid #111' }}>
              {Array.isArray(messages) && messages.map((m, i) => {
                let msgColor = '#888'; 
                if (m?.role === 'user') msgColor = '#00d4ff';
                if (m?.role === 'admin') msgColor = '#00ffcc'; 

                return (
                  <div key={i} style={{ fontSize: '10px', color: msgColor, marginBottom: '6px' }}>
                    <strong>{String(m?.role || 'SYSTEM').toUpperCase()}:</strong> {m?.text || ''}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                value={supportMessage || ''}
                onChange={(e) => setSupportMessage(e.target.value)}
                placeholder="Enter network error hash..."
                style={{ padding: '6px', background: '#000', color: '#fff', border: '1px solid #111', borderRadius: '6px', fontSize: '11px', flex: 1 }}
              />
              <button
                onClick={() => {
                  handleCreateTicket(supportMessage);
                  setSupportMessage('');
                }}
                style={{ background: '#00ffcc', color: '#000', border: 'none', borderRadius: '6px', padding: '0 12px', fontSize: '11px', fontWeight: 'bold' }}
              >
                SEND
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🦅 SHRUKEN CORE BUTTON FOR ZERO LAYOUT OVERLAP */}
      <div style={{ position: 'fixed', bottom: '15px', right: '15px', zIndex: 10010 }}>
        <button onClick={() => setShowSupport(!showSupport)} style={{ width: '56px', height: '56px', background: '#00ffcc', borderRadius: '50%', border: 'none', boxShadow: '0 0 20px rgba(0, 255, 204, 0.4)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '20px' }}>🪽</span>
          <span style={{ fontSize: '8px', fontWeight: '900', color: '#000' }}>SUPPORT</span>
        </button>
      </div>

      {/* 🦅 COPY TOAST */}
      {showCopyToast && (
        <div style={{ position: 'fixed', bottom: '120px', left: '50%', transform: 'translateX(-50%)', background: '#00d4ff', color: '#000', padding: '8px 20px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold', zIndex: 10002 }}>
          ✅ COPIED
        </div>
      )}

    </div>
  );
};

const containerStyle = { background: '#080808', border: '1px solid #1a1a1a', padding: '20px', borderRadius: '20px', color: '#fff', maxWidth: '420px', margin: 'auto' };
const groupStyle = { display: 'flex', flexDirection: 'column', gap: '15px' };
const labelStyle = { fontSize: '9px', color: '#444', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' };
const inputStyle = { padding: '12px', background: '#000', color: '#fff', border: '1px solid #111', borderRadius: '10px', fontSize: '13px', width: '100%', boxSizing: 'border-box', height: '45px' };
const btnStyle = { padding: '14px', background: '#00d4ff', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: '10px', cursor: 'pointer' };
const overlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalStyle = { background: '#0a0a0a', padding: '25px', borderRadius: '20px', width: '90%', maxWidth: '380px', textAlign: 'center', border: '1px solid #1a1a1a' };
const boxStyle = { background: '#000', padding: '15px', borderRadius: '12px', margin: '15px 0', border: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 'fit-content' };
const logoStyle = { width: '42px', height: '42px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #00d4ff', overflow: 'hidden', flexShrink: 0 };
const deckRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#000', borderRadius: '12px', border: '1px solid #111' };
const sophisticatedModalStyle = { background: '#0a0a0a', border: '1px solid #00d4ff', borderRadius: '40px', padding: '40px', width: '90%', maxWidth: '400px', position: 'relative', zIndex: 10001, boxShadow: '0 0 50px rgba(0, 212, 255, 0.2)' };
const closeBtnStyle = { position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer' };
const copyBtnStyle = { background: 'transparent', color: '#00e5ff', border: '1px solid #00e5ff', padding: '4px 10px', borderRadius: '6px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer', transition: '0.3s all' };
const sendBtnStyle = { background: '#00d4ff', color: '#000', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' };
const supportBubbleStyle = { width: '75px', height: '75px', background: '#00ffcc', borderRadius: '50%', border: 'none', boxShadow: '0 0 35px rgba(0, 255, 204, 0.5)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10001 };
const supportCardStyle = { position: 'absolute', bottom: '95px', right: '0', width: '300px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '30px', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' };
const supportHeaderStyle = { background: '#00ffcc', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#000' };
const spinnerStyle = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(0,0,0,0.3);
    border-top: 2px solid #000;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
`;

const TicketRow = ({ t, idx, isChat, color, status, userAddress, ADMIN_WALLET, handleResolveTicket, setReplyingTo, setServerMemo, setServerDepositAddr, setShowModal, deckRow, copyBtnStyle }) => {
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    if (status !== 'PENDING' && status !== 'AWAITING_DEPOSIT' && status !== 'PROCESSING' && status !== 'WAITING') return;
    const updateTimer = () => {
      const created = new Date(t.createdAt).getTime();
      const expiry = created + (24 * 60 * 60 * 1000);
      const diff = expiry - Date.now();
      if (diff <= 0) { setTimeLeft("EXPIRED"); }
      else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        setTimeLeft(`${hours}h ${mins}m left`);
      }
    };
    updateTimer();
    const timer = setInterval(updateTimer, 60000);
    return () => clearInterval(timer);
  }, [t.createdAt, status]);

  return (
    <div key={t._id || idx} style={{ ...deckRow, borderLeft: `4px solid ${color}`, background: t.resolved ? 'rgba(255,255,255,0.02)' : '#000', marginBottom: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ fontSize: '22px' }}>{isChat ? '💬' : '🎫'}</div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: '12px', fontWeight: 'bold', color: '#fff' }}>{isChat ? `SUPPORT: ${t._id.slice(-6)}` : `${t.fromChain} ➔ ${t.toChain}`}</p>
          <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#666' }}>{isChat ? t.issue.slice(0, 30) + '...' : `${t.amount} ${t.symbol}`}</p>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <p style={{ margin: '0 0 2px 0', fontSize: '9px', color: color, fontWeight: '900', letterSpacing: '1px' }}>● {status}</p>
        {(status === 'PENDING' || status === 'AWAITING_DEPOSIT' || status === 'PROCESSING' || status === 'WAITING') && (
          <p style={{ fontSize: '10px', color: '#00ffcc', margin: '0 0 4px 0', fontWeight: '900', fontFamily: 'monospace', textShadow: '0 0 8px #00ffcc, 0 0 12px rgba(0, 255, 204, 0.3)', letterSpacing: '1px' }}>{timeLeft}</p>
        )}
        <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
          <button onClick={() => { if (isChat) { setReplyingTo(t); } else { setServerMemo(t.memo); setServerDepositAddr(t.depositAddress); setShowModal(true); } }} style={{ ...copyBtnStyle, borderColor: color, color: color }}>{isChat ? 'CHAT' : 'VIEW'}</button>
        </div>
      </div>
    </div>
  );
};

export default BridgeWidget;
