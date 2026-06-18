// dashboard/src/components/LoginGate.jsx
// Placeholder login. Shown when the API rejects the stored token (401). The
// editor enters the dashboard token once; it's saved in the browser and used
// for all API calls. Not real auth — a shared token gate, per spec.
import React, { useState } from 'react';
import { api, setToken } from '../api.js';

export function LoginGate({ onAuthed }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setToken(value.trim());
    try {
      await api.getSettings(); // verifies the token
      onAuthed();
    } catch (err) {
      setError(err.status === 401 ? 'That token was rejected. Check DASH_TOKEN on the server.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-gate">
      <form onSubmit={submit}>
        <h1>TSD Wire Desk</h1>
        <p>Enter the dashboard access token to continue.</p>
        <input
          type="password"
          placeholder="Dashboard token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Sign in'}</button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}
