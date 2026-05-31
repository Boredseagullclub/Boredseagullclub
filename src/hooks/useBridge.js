import { useState, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

// 🦅 DYNAMIC PATH RESOLVER: Uses the current hostname your phone is connecting to
const HOST = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.') 
  ? '' 
  : `${window.location.protocol}//${window.location.host}`;

const API_BASE = `${HOST}/api`;

export const useBridge = (publicAddress) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 🦅 Prevent running requests with invalid or dummy string states
    if (!publicAddress || publicAddress === 'sovereign_user' || publicAddress === 'GUEST_MODE') {
      setLoading(false);
      return;
    }

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

    // Listen for Live "Heartbeats" relative to the connected server host
    const socket = io(HOST || window.location.origin);
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
