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

  const [withdraw, setWithdraw] = useState({
    token: 'XRP',
    amount: '',
    destination: '',
    chain: 'XRP',
  });

  // Socket for real-time deposits
  useEffect(() => {
    if (!token) return;

    const socket = io(SOCKET_URL, { auth: { token } });

    socket.on('connect', () => {
      socket.emit('join', 'user-room'); // Replace with real user ID later
    });

    socket.on('DEPOSIT_CREDITED', (data) => {
      setNotifications((prev) => [...prev, data]);
      fetchBalances();
    });

    return () => socket.disconnect();
  }, [token]);

  // Fetch balances
  const fetchBalances = async () => {
    try {
      const res = await axios.get(`${API_BASE}/wallet/balances`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBalances(res.data.balances || {});
    } catch (err) {
      console.error('Failed to fetch balances', err);
    }
  };

  // Register passkey
  const register = async () => {
    try {
      const { data: options } = await axios.post(`${API_BASE}/auth/passkey/register/start`, {
        publicAddress,
        // Add real wallet signature later
        signature: 'mock-sig',
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
      fetchBalances();
      alert('Registered & logged in!');
    } catch (err) {
      alert('Registration failed: ' + err.message);
    }
  };

  // Login with passkey
  const login = async () => {
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
      fetchBalances();
      alert('Logged in!');
    } catch (err) {
      alert('Login failed: ' + err.message);
    }
  };

  // Withdraw
  const doWithdraw = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/withdraw`, withdraw, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Withdrawal requested!');
    } catch (err) {
      alert('Withdraw failed: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <h1>Seagull Wallet (Non-Custodial)</h1>

      {!token ? (
        <div>
          <input
            type="text"
            placeholder="Your wallet address (r... / 0x...)"
            value={publicAddress}
            onChange={(e) => setPublicAddress(e.target.value)}
            style={{ width: '100%', marginBottom: '1rem' }}
          />
          <button onClick={register}>Register Passkey</button>
          <button onClick={login} style={{ marginLeft: '1rem' }}>Login</button>
        </div>
      ) : (
        <>
          <h2>Balances</h2>
          <ul>
            {Object.entries(balances).map(([k, v]) => (
              <li key={k}>{k}: {v}</li>
            ))}
          </ul>

          <h3>Deposits</h3>
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
            <button type="submit">Withdraw</button>
          </form>

          <button onClick={() => { localStorage.removeItem('token'); setToken(''); }}>
            Logout
          </button>
        </>
      )}
    </div>
  );
}

export default App;
