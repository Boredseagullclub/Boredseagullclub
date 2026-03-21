import React, { useState } from 'react';
import { usePasskey } from '../hooks/usePasskey';

const LoginButton = ({ publicAddress, onLoginSuccess }) => {
  const { registerPasskey, loginWithPasskey } = usePasskey();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handlePasskeyAction = async (action) => {
    setLoading(true);
    setError(null);
    try {
      let result;
      if (action === 'register') {
        result = await registerPasskey(publicAddress);
      } else {
        result = await loginWithPasskey(publicAddress);
      }

      if (result?.success) {
        onLoginSuccess(result.token);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!publicAddress) {
    return <p className="text-sm text-gray-500">Please connect your wallet first.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          onClick={() => handlePasskeyAction('login')}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Authenticating...' : 'Login with Passkey'}
        </button>

        <button
          onClick={() => handlePasskeyAction('register')}
          disabled={loading}
          className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
        >
          Register New Device
        </button>
      </div>

      {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
    </div>
  );
};

export default LoginButton;
