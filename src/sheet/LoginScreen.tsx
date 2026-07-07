import { useState } from 'react';
import { supabase } from '../data/supabase';
import { HeroesHeavenLogo } from './Logo';
import { WindowControls } from './WindowControls';

/**
 * Passwordless email sign-in. Uses an emailed 6-digit CODE (typed into the app) rather than only a
 * magic link, because installed PWAs on phones have their own storage and a tapped link opens in the
 * browser — not the app — so link-based login can't complete inside an installed app. The email also
 * still contains the link (works fine in a desktop browser); the code path works everywhere.
 * Only invited emails can sign in (shouldCreateUser:false → the Supabase allowlist rejects the rest).
 */
export function LoginScreen({ onSkip, onDevSkip }: { onSkip?: () => void; onDevSkip?: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'email' | 'sending' | 'code' | 'verifying'>('email');
  const [error, setError] = useState('');

  const sendCode = async () => {
    const addr = email.trim();
    if (!supabase || !addr || phase === 'sending') return;
    setPhase('sending');
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    if (error) {
      setPhase('email');
      const msg = error.message || '';
      setError(
        /signup|not allowed|not found|no user|Unable to validate|Email not/i.test(msg)
          ? "That email isn't on the invite list yet. Ask the owner to add it, then try again."
          : msg || 'Could not send the code. Check the address and try again.',
      );
    } else {
      setPhase('code');
    }
  };

  const verify = async () => {
    const token = code.trim();
    if (!supabase || token.length < 6 || phase === 'verifying') return;
    setPhase('verifying');
    setError('');
    // The emailed OTP is normally type 'email'; some configs classify it as 'magiclink'. Try both
    // before failing (a rejected verify doesn't consume the code, so the retry is safe).
    let res = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (res.error) {
      const alt = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'magiclink' });
      if (!alt.error) res = alt;
    }
    if (res.error) {
      setPhase('code');
      setError("That code didn't work — double-check it, or resend a new one.");
    }
    // On success, onAuthStateChange signs the app in (this same context — no redirect).
  };

  const onCode = phase === 'code' || phase === 'verifying';

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
          {onCode ? (
            <>
              <h1 className="login-title">Enter your code</h1>
              <p className="login-sub">
                We emailed a code to <b>{email.trim()}</b>. Type it here to sign in.
              </p>
              <input
                className="login-input login-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={10}
                placeholder="Code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''));
                  if (error) setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void verify();
                }}
              />
              {error && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="btn login-send"
                onClick={() => void verify()}
                disabled={phase === 'verifying' || code.trim().length < 4}
              >
                {phase === 'verifying' ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                className="btn login-alt"
                onClick={() => {
                  setPhase('email');
                  setCode('');
                  setError('');
                }}
              >
                Use a different email
              </button>
            </>
          ) : (
            <>
              <h1 className="login-title">Sign in</h1>
              <p className="login-sub">No password — we'll email you a sign-in code.</p>
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
                  if (error) setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendCode();
                }}
              />
              {error && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="btn login-send"
                onClick={() => void sendCode()}
                disabled={phase === 'sending' || !email.trim()}
              >
                {phase === 'sending' ? 'Sending…' : 'Email me a code'}
              </button>
              <p className="login-note">
                Only invited emails can sign in. Ask whoever set this up to add yours if it doesn't work.
              </p>
              {onSkip && (
                <>
                  <div className="login-or">or</div>
                  <button className="btn login-skip" onClick={onSkip}>
                    Continue without an account
                  </button>
                  <p className="login-note">
                    Your characters stay on this device. Sign in later from Settings → Account to back them up and sync
                    across your devices.
                  </p>
                </>
              )}
            </>
          )}
        </div>
        {import.meta.env.DEV && onDevSkip && (
          <button className="login-devskip" onClick={onDevSkip} title="Local dev only — not shown on the live site">
            Skip login (dev only)
          </button>
        )}
      </div>
    </div>
  );
}
