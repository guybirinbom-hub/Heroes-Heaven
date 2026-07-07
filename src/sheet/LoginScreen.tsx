import { useState } from 'react';
import { supabase } from '../data/supabase';
import { HeroesHeavenLogo } from './Logo';
import { WindowControls } from './WindowControls';

/** Passwordless email sign-in for the web build. Sends a one-time magic link; only invited emails
 *  can sign in (shouldCreateUser:false — the Supabase allowlist rejects everyone else). */
export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const send = async () => {
    const addr = email.trim();
    if (!supabase || !addr || phase === 'sending') return;
    setPhase('sending');
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    if (error) {
      setPhase('error');
      const msg = error.message || '';
      // With shouldCreateUser:false a non-invited email returns a signups-disabled / not-found error.
      setError(
        /signup|not allowed|not found|no user|Unable to validate|Email not/i.test(msg)
          ? "That email isn't on the invite list yet. Ask the owner to add it, then try again."
          : msg || 'Could not send the link. Check the address and try again.',
      );
    } else {
      setPhase('sent');
    }
  };

  return (
    <div className="login-screen">
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          <HeroesHeavenLogo className="chrome-logo" /> Heroes Heaven
        </div>
        <WindowControls />
      </header>
      <div className="login-body">
        <div className="login-card">
          <HeroesHeavenLogo className="login-logo" />
          {phase === 'sent' ? (
            <>
              <h1 className="login-title">Check your email</h1>
              <p className="login-sub">
                We sent a sign-in link to <b>{email.trim()}</b>. Open it to sign in — your characters
                will be waiting.
              </p>
              <button className="btn login-alt" onClick={() => setPhase('idle')}>
                Use a different email
              </button>
            </>
          ) : (
            <>
              <h1 className="login-title">Sign in</h1>
              <p className="login-sub">No password — we'll email you a one-time sign-in link.</p>
              <input
                className="login-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (phase === 'error') setPhase('idle');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void send();
                }}
              />
              {phase === 'error' && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="btn login-send"
                onClick={() => void send()}
                disabled={phase === 'sending' || !email.trim()}
              >
                {phase === 'sending' ? 'Sending…' : 'Send me a sign-in link'}
              </button>
              <p className="login-note">
                Only invited emails can sign in. Ask whoever set this up to add yours if it doesn't work.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
