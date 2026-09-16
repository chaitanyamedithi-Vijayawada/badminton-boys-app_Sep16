import { useState, useEffect } from 'react';
import { Mail, ChevronRight, Check, ArrowLeft, Delete } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { makeInitials } from '../lib/constants';
import PlayerAvatar from './PlayerAvatar';
import { supabase } from '../lib/supabase';

const PAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

function PinPad({ pin, onChange }: { pin: string; onChange: (p: string) => void }) {
  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    onChange(pin + d);
  };
  const handleDelete = () => onChange(pin.slice(0, -1));

  return (
    <div style={{ width: '100%', maxWidth: 260, margin: '0 auto' }}>
      {/* Dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: '50%',
            background: i < pin.length ? '#7c5cff' : 'transparent',
            border: `2px solid ${i < pin.length ? '#7c5cff' : 'rgba(124,92,255,0.2)'}`,
            boxShadow: i < pin.length ? '0 0 10px rgba(124,92,255,0.6)' : 'none',
            transition: 'all 0.15s',
          }} />
        ))}
      </div>
      {/* Keypad */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {PAD.map((key, i) => {
          if (key === '') return <div key={i} />;
          if (key === '⌫') return (
            <button key={i} onClick={handleDelete} style={{
              height: 52, borderRadius: 14,
              background: 'rgba(26,19,56,0.85)', border: '1px solid rgba(124,92,255,0.18)',
              color: '#94a3b8', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
              <Delete size={18} />
            </button>
          );
          return (
            <button key={i} onClick={() => handleDigit(key)} style={{
              height: 52, borderRadius: 14,
              background: 'rgba(26,19,56,0.85)', border: '1px solid rgba(124,92,255,0.18)',
              color: '#f1f5f9', fontSize: 20, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function NamePicker() {
  const { players, setMyName, setShowNamePicker, showNamePicker, myName, dataReady,
          loadPlayers, loginWithPin, setupPin, isLoggedIn } = useApp();

  const [step, setStep] = useState<'pick' | 'email' | 'pin-entry' | 'pin-setup' | 'pin-confirm'>('pick');
  const [selectedName, setSelectedName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');

  useEffect(() => {
    if (dataReady && !myName) setShowNamePicker(true);
  }, [dataReady, myName]);

  // If returning user is already logged in, close picker
  useEffect(() => {
    if (dataReady && myName && isLoggedIn) setShowNamePicker(false);
  }, [dataReady, myName, isLoggedIn]);

  // If returning user has name but not logged in, go to PIN entry
  useEffect(() => {
    if (dataReady && myName && !isLoggedIn && showNamePicker) {
      const player = players.find(p => p.name === myName);
      if (player?.pin) {
        setSelectedName(myName);
        setStep('pin-entry');
      }
    }
  }, [dataReady, myName, isLoggedIn, showNamePicker, players]);

  useEffect(() => {
    if (!showNamePicker) {
      setStep('pick');
      setSelectedName('');
      setEmail('');
      setPin('');
      setConfirmPin('');
      setPinError('');
    }
  }, [showNamePicker]);

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (step === 'pin-entry' && pin.length === 4) {
      handlePinLogin();
    }
  }, [pin, step]);

  useEffect(() => {
    if (step === 'pin-confirm' && confirmPin.length === 4) {
      handlePinConfirm();
    }
  }, [confirmPin, step]);

  if (!showNamePicker) return null;

  const handleSelect = async (name: string) => {
    const player = players.find(p => p.name === name);
    setSelectedName(name);
    setEmail(player?.email ?? '');
    setPin('');
    setPinError('');

    if (player?.pin) {
      // Has PIN → go to PIN entry
      setStep('pin-entry');
    } else {
      // No PIN → collect email first
      setStep('email');
    }
  };

  const handleConfirmEmail = async () => {
    if (!selectedName) return;
    setSaving(true);
    const trimmed = email.trim().toLowerCase();
    if (trimmed) {
      await supabase.from('players').update({ email: trimmed }).eq('name', selectedName);
      await loadPlayers();
    }
    setSaving(false);
    // Go to PIN setup
    setPin('');
    setStep('pin-setup');
  };

  const handlePinLogin = async () => {
    const ok = await loginWithPin(selectedName, pin);
    if (ok) {
      setMyName(selectedName);
      setShowNamePicker(false);
    } else {
      setPinError('Incorrect PIN. Please try again.');
      setPin('');
    }
  };

  const handlePinConfirm = async () => {
    if (confirmPin !== pin) {
      setPinError('PINs do not match. Please try again.');
      setConfirmPin('');
      return;
    }
    setSaving(true);
    await setupPin(selectedName, pin);
    setMyName(selectedName);
    setShowNamePicker(false);
    setSaving(false);
  };

  const selectedPlayer = players.find(p => p.name === selectedName);
  const emailValid = email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9999, background: 'rgba(12,8,28,0.98)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-start', overflowY: 'auto', padding: '0 0 40px 0',
    }}>
      {/* Header */}
      <div style={{
        width: '100%', padding: '60px 24px 24px', textAlign: 'center',
        background: 'linear-gradient(180deg, #120d26 0%, transparent 100%)',
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        <div style={{ fontSize: 42, marginBottom: 12 }}>🏸</div>

        {step === 'pick' && (
          <>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#f0f0f5', marginBottom: 8 }}>Welcome to Badminton Boys!</div>
            <div style={{ fontSize: 13, color: '#55556a' }}>Who are you? Pick your name to get started.</div>
          </>
        )}
        {step === 'email' && (
          <>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f5', marginBottom: 6 }}>Hi, {selectedName}!</div>
            <div style={{ fontSize: 13, color: '#55556a', maxWidth: 280, margin: '0 auto' }}>
              Add your email to receive session stats and monthly summaries.
            </div>
          </>
        )}
        {step === 'pin-entry' && (
          <>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f5', marginBottom: 6 }}>
              Welcome back, {selectedName}!
            </div>
            <div style={{ fontSize: 13, color: '#55556a' }}>Enter your PIN to continue.</div>
          </>
        )}
        {step === 'pin-setup' && (
          <>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f5', marginBottom: 6 }}>Set your PIN</div>
            <div style={{ fontSize: 13, color: '#55556a' }}>Choose a 4-digit PIN to secure your account.</div>
          </>
        )}
        {step === 'pin-confirm' && (
          <>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f5', marginBottom: 6 }}>Confirm your PIN</div>
            <div style={{ fontSize: 13, color: '#55556a' }}>Enter your PIN again to confirm.</div>
          </>
        )}
      </div>

      <div style={{ width: '100%', maxWidth: 430, padding: '8px 16px' }}>

        {/* STEP: Pick name */}
        {step === 'pick' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {players.map((p) => (
              <button key={p.name} onClick={() => handleSelect(p.name)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', background: 'linear-gradient(135deg,rgba(124,92,255,0.10),rgba(196,77,219,0.05))', border: '1px solid rgba(124,92,255,0.18)',
                borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.border = '1px solid rgba(124,92,255,0.6)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.border = '1px solid rgba(124,92,255,0.18)'; }}
              >
                <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <PlayerAvatar player={p} size={44} enlargeable />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0f5' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#55556a', marginTop: 2 }}>
                    {p.pin ? '🔒 PIN set' : 'Tap to continue'}
                  </div>
                </div>
                <ChevronRight size={16} color="#33334a" />
              </button>
            ))}
          </div>
        )}

        {/* STEP: Email */}
        {step === 'email' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {selectedPlayer && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                background: 'linear-gradient(135deg,rgba(124,92,255,0.15),rgba(196,77,219,0.08))', border: '1px solid rgba(124,92,255,0.35)', borderRadius: 14,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: selectedPlayer.color.bg, color: selectedPlayer.color.fg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, flexShrink: 0,
                }}>{makeInitials(selectedPlayer.name)}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0f5' }}>{selectedPlayer.name}</div>
                  <div style={{ fontSize: 11, color: '#3a7a3a' }}>Selected</div>
                </div>
              </div>
            )}
            <div>
              <label style={{ fontSize: 12, color: '#55556a', display: 'block', marginBottom: 8 }}>
                Email address (optional)
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} color="#55556a" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" style={{
                    width: '100%', background: 'rgba(26,19,56,0.85)',
                    border: `1px solid ${!emailValid ? '#7f1d1d' : 'rgba(124,92,255,0.25)'}`,
                    borderRadius: 12, padding: '12px 14px 12px 40px',
                    fontSize: 14, color: '#f0f0f5', outline: 'none', boxSizing: 'border-box',
                  }} />
              </div>
              {!emailValid && <div style={{ fontSize: 11, color: '#f87171', marginTop: 5 }}>Please enter a valid email.</div>}
            </div>
            <button onClick={handleConfirmEmail} disabled={saving || !emailValid} style={{
              width: '100%', padding: 14,
              background: saving || !emailValid ? 'rgba(26,19,56,0.85)' : '#7c5cff',
              border: 'none', borderRadius: 14,
              color: saving || !emailValid ? '#55556a' : '#fff',
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Check size={16} />
              {saving ? 'Saving...' : 'Continue'}
            </button>
            <button onClick={() => setStep('pick')} style={{
              width: '100%', padding: 12, background: 'transparent',
              border: '1px solid #252538', borderRadius: 14, color: '#55556a',
              fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <ArrowLeft size={14} /> Not me — go back
            </button>
          </div>
        )}

        {/* STEP: PIN Entry (returning user) */}
        {step === 'pin-entry' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            {pinError && (
              <div style={{
                width: '100%', padding: '10px 14px', background: '#1c0a0a',
                border: '1px solid #7f1d1d', borderRadius: 10,
                fontSize: 13, color: '#f87171', textAlign: 'center',
              }}>{pinError}</div>
            )}
            <PinPad pin={pin} onChange={p => { setPin(p); setPinError(''); }} />
            <button onClick={() => { setStep('pick'); setSelectedName(''); setPin(''); setPinError(''); }}
              style={{
                marginTop: 8, background: 'transparent', border: 'none',
                color: '#55556a', fontSize: 13, cursor: 'pointer',
              }}>
              Switch Player
            </button>
            <div style={{ fontSize: 12, color: '#374151', textAlign: 'center', marginTop: 4 }}>
              Forgot your PIN? Ask an admin to reset it for you.
            </div>
          </div>
        )}

        {/* STEP: PIN Setup */}
        {step === 'pin-setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <PinPad pin={pin} onChange={setPin} />
            <button
              onClick={() => { if (pin.length === 4) { setPinError(''); setConfirmPin(''); setStep('pin-confirm'); } }}
              disabled={pin.length < 4}
              style={{
                width: '100%', maxWidth: 260, padding: 14,
                background: pin.length < 4 ? 'rgba(26,19,56,0.85)' : '#7c5cff',
                border: 'none', borderRadius: 14,
                color: pin.length < 4 ? '#55556a' : '#fff',
                fontSize: 15, fontWeight: 700, cursor: pin.length < 4 ? 'not-allowed' : 'pointer',
              }}>
              Continue
            </button>
          </div>
        )}

        {/* STEP: PIN Confirm */}
        {step === 'pin-confirm' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            {pinError && (
              <div style={{
                width: '100%', padding: '10px 14px', background: '#1c0a0a',
                border: '1px solid #7f1d1d', borderRadius: 10,
                fontSize: 13, color: '#f87171', textAlign: 'center',
              }}>{pinError}</div>
            )}
            <PinPad pin={confirmPin} onChange={p => { setConfirmPin(p); setPinError(''); }} />
            <button onClick={() => { setStep('pin-setup'); setPin(''); setConfirmPin(''); setPinError(''); }}
              style={{
                background: 'transparent', border: 'none',
                color: '#55556a', fontSize: 13, cursor: 'pointer',
              }}>
              ← Change PIN
            </button>
          </div>
        )}

        {/* Theme picker moved to Profile (Header → 🔥 Profile). */}
      </div>
    </div>
  );
}