import { useState, useEffect } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

const API_BASE = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

function App() {
  const [publicAddress, setPublicAddress] = useState('');
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [balances, setBalances] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Socket.IO
  useEffect(() => {
    if (!token) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
    });

    socket.on('connect', () => {
      socket.emit('join', 'user-placeholder'); // TODO: replace with real userId
    });

    socket.on('DEPOSIT_CREDITED', (data) => {
      setNotifications((prev) => [...prev, data]);
      fetchBalances();
    });

    socket.on('connect_error', (err) => console.error('Socket error:', err));

    return () => socket.disconnect();
  }, [token]);

  const fetchBalances = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/wallet/balances`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBalances(res.data.balances || {});
      setError(null);
    } catch (err) {
      setError('Failed to load balances');
    } finally {
      setLoading(false);
    }
  };

  const register = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: options } = await axios.post(`${API_BASE}/auth/passkey/register/start`, {
        publicAddress,
        signature: 'mock-sig', // TODO: real wallet sig
        nonce: Date.now(),
        timestamp: Date.now(),
        chain: 'XRP',
      });

      const credential = await startRegistration(options);

      const { data } = await axios.post(`${API_BASE}/auth/passkey/register/finish`, {
        publicAddress,
        response: credential,
      });

      localStorage.setItem('token', data.token);
      setToken(data.token);
      await fetchBalances();
      alert('Registered & logged in!');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: options } = await axios.post(`${API_BASE}/auth/passkey/login/start`, {
        publicAddress,
      });

      const credential = await startAuthentication(options);

      const { data } = await axios.post(`${API_BASE}/auth/passkey/login/finish`, {
        publicAddress,
        response: credential,
      });

      localStorage.setItem('token', data.token);
      setToken(data.token);
      await fetchBalances();
      alert('Logged in!');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken('');
    setBalances({});
    setNotifications([]);
    setError(null);
  };

  const doWithdraw = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API_BASE}/withdraw`, withdraw, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Withdrawal requested!');
    } catch (err) {
      setError(err.response?.data?.error || 'Withdrawal failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ textAlign: 'center' }}>Seagull Wallet (Non-Custodial)</h1>

      {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}

      {!token ? (
        <div style={{ textAlign: 'center' }}>
          <input
            type="text"
            placeholder="Your wallet address (r... or 0x...)"
            value={publicAddress}
            onChange={(e) => setPublicAddress(e.target.value.trim())}
            style={{ width: '100%', padding: '0.8rem', marginBottom: '1rem' }}
          />
          <button onClick={register} disabled={loading}>
            {loading ? 'Registering...' : 'Register Passkey'}
          </button>
          <button onClick={login} disabled={loading} style={{ marginLeft: '1rem' }}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </div>
      ) : (
        <>
          <h2>Balances</h2>
          {loading ? <p>Loading...</p> : (
            <ul>
              {Object.entries(balances).map(([k, v]) => (
                <li key={k}>{k}: {v}</li>
              ))}
            </ul>
          )}

          <h3>Recent Deposits</h3>
          <ul>
            {notifications.map((n, i) => (
              <li key={i}>+ {n.amount} {n.token} ({n.chain})</li>
            ))}
          </ul>

          <form onSubmit={doWithdraw}>
            <select value={withdraw.token} onChange={e => setWithdraw({ ...withdraw, token: e.target.value })}>
              <option>XRP</option>
              <option>XDC</option>
              <option>FLR</option>
            </select>
            <input
              type="number"
              placeholder="Amount"
              value={withdraw.amount}
              onChange={e => setWithdraw({ ...withdraw, amount: e.target.value })}
              required
            />
            <input
              placeholder="Your destination address"
              value={withdraw.destination}
              onChange={e => setWithdraw({ ...withdraw, destination: e.target.value })}
              required
            />
            <select value={withdraw.chain} onChange={e => setWithdraw({ ...withdraw, chain: e.target.value })}>
              <option>XRP</option>
              <option>XDC</option>
              <option>FLR</option>
            </select>
            <button type="submit" disabled={loading}>
              {loading ? 'Processing...' : 'Withdraw'}
            </button>
          </form>

          <button onClick={logout} style={{ marginTop: '2rem', color: 'red' }}>
            Logout
          </button>
        </>
      )}
    </div>
  );
}

export default App;
