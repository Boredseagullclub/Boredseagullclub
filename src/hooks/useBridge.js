import { useState, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

const API_BASE = 'https://www.seagull-xlm.xyz/api';

export const useBridge = (publicAddress) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicAddress) return;

    // 1. Fetch initial state from the "Tank" Backend
    const fetchUser = async () => {
      try {
        const res = await axios.get(`${API_BASE}/user/${publicAddress}`);
        setUser(res.data);
      } catch (err) {
        console.error("Eagle eye failed to find user:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();

    // 2. Listen for Live "Heartbeats" (Swaps/KYC updates)
    const socket = io('https://www.seagull-xlm.xyz');
    socket.emit('join', publicAddress);

    socket.on('KYC_UPDATE', (data) => {
      setUser(prev => ({ ...prev, kycStatus: data.status }));
    });

    socket.on('BALANCE_UPDATE', (data) => {
      setUser(prev => ({ ...prev, balances: data.newBalances }));
    });

    return () => socket.disconnect();
  }, [publicAddress]);

  return { user, loading };
};

