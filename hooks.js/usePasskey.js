import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import axios from 'axios';

export const usePasskey = () => {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

  /**
   * REGISTRATION: Link a new biometric device to the account
   */
  const registerPasskey = async (publicAddress) => {
    try {
      // 1. Get options from your backend
      const { data: options } = await axios.post(`${API_BASE}/passkey/register/start`, { 
        publicAddress 
      });

      // 2. Trigger the browser's native FaceID/TouchID prompt
      const regResponse = await startRegistration(options);

      // 3. Send the hardware response back to verify and save
      const { data: result } = await axios.post(`${API_BASE}/passkey/register/finish`, {
        publicAddress,
        response: regResponse
      });

      if (result.token) {
        localStorage.setItem('token', result.token);
        return { success: true, token: result.token };
      }
    } catch (err) {
      console.error('Registration failed:', err);
      throw new Error(err.response?.data?.error || 'Passkey registration failed');
    }
  };

  /**
   * LOGIN: Authenticate using an existing Passkey
   */
  const loginWithPasskey = async (publicAddress) => {
    try {
      // 1. Get authentication challenge
      const { data: options } = await axios.post(`${API_BASE}/passkey/login/start`, { 
        publicAddress 
      });

      // 2. Browser prompt for existing Passkey
      const authResponse = await startAuthentication(options);

      // 3. Verify signature on backend and get JWT
      const { data: result } = await axios.post(`${API_BASE}/passkey/login/finish`, {
        publicAddress,
        response: authResponse
      });

      if (result.token) {
        localStorage.setItem('token', result.token);
        return { success: true, token: result.token };
      }
    } catch (err) {
      console.error('Login failed:', err);
      throw new Error(err.response?.data?.error || 'Passkey login failed');
    }
  };

  return { registerPasskey, loginWithPasskey };
};
