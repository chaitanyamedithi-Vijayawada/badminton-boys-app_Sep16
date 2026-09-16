import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { uploadAvatarFor, removeAvatarFor } from '../lib/avatar';
import { makeInitials, THEMES, getSavedTheme, applyTheme, type ThemeId } from '../lib/constants';
import { Delete, LayoutGrid } from 'lucide-react';
import type { TabId } from '../types';

const PAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

function PinPad({ pin, onChange }: { pin: string; onChange: (p: string) => void }) {
  const handleDigit = (d: string) => { if (pin.length < 4) onChange(pin + d); };
  const handleDelete = () => onChange(pin.slice(0, -1));
  return (
    <div style={{ width: '100%', maxWidth: 220, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{
            width: 12, height: 12, borderRadius: '50%',
            background: i < pin.length ? 'var(--accent)' : 'transparent',
            border: `2px solid ${i < pin.length ? 'var(--accent)' : '#334155'}`,
            transition: 'all 0.15s',
          }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {PAD.map((key, i) => {
          if (key === '') return <div key={i} />;
          if (key === '⌫') return (
            <button key={i} onClick={handleDelete} style={{
              height: 44, borderRadius: 10, background: '#1e293b',
              border: '1px solid #334155', color: '#94a3b8',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Delete size={16} /></button>
          );
          return (
            <button key={i} onClick={() => handleDigit(key)} style={{
              height: 44, borderRadius: 10, background: '#1e293b',
              border: '1px solid #334155', color: '#f1f5f9',
              fontSize: 18, fontWeight: 600, cursor: 'pointer',
            }}>{key}</button>
          );
        })}
      </div>
    </div>
  );
}

export default function Header({ showAdmins = false }: { showAdmins?: boolean }) {
  const { settings, myName, players, logout, loginWithPin, setupPin, loadPlayers, hiddenTabs, toggleTabVisibility } = useApp();

  const currentPlayer = players.find(p => p.name === myName);
  const initials = myName ? makeInitials(myName) : '?';

  const [showModal, setShowModal] = useState(false);
  const [changePinStep, setChangePinStep] = useState<null | 'current' | 'new' | 'confirm'>( null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // Live theme state mirrored from the saved theme so the picker swatches
  // highlight correctly and updates take effect immediately.
  const [activeTheme, setActiveTheme] = useState<ThemeId>(getSavedTheme);
  const handleThemeChange = (id: ThemeId) => {
    setActiveTheme(id);
    applyTheme(id);
  };
  // Shirt size + photo upload state
  const [savingShirt, setSavingShirt] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  // Collapsible sections — shirt size and theme are set-once settings, so they
  // stay folded behind a summary row to keep the menu short.
  const [shirtOpen, setShirtOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [tabsOpen, setTabsOpen] = useState(false);

  const TAB_MANAGEMENT: { id: TabId; label: string; icon: string }[] = [
    { id: 'sessions',   label: 'Sessions',   icon: '🏠' },
    { id: 'players',    label: 'Players',     icon: '👥' },
    { id: 'fees',       label: 'Fees',        icon: '💰' },
    { id: 'match',      label: 'Match',       icon: '🏸' },
    { id: 'tournament', label: 'Tournament',  icon: '🏆' },
    { id: 'history',    label: 'History',     icon: '📜' },
    { id: 'admin',      label: 'Admin',       icon: '⚙️' },
  ];

  // Shared styling for a collapsed settings row: label left, current value right.
  const settingRowStyle: React.CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '11px 2px', background: 'none', border: 'none',
    borderTop: '1px solid #1e1e2e', cursor: 'pointer', textAlign: 'left',
  };
  const settingLabelStyle: React.CSSProperties = { fontSize: 13, color: '#cbd5e1', fontWeight: 500 };
  const settingValueStyle: React.CSSProperties = { fontSize: 13, color: '#8b93a7', display: 'flex', alignItems: 'center', gap: 4 };

  const EMOJIS = ['🏸', '⚡', '🔥', '💪', '🎯', '🦅', '🐉', '🦁', '🐯', '🦊', '🐺', '🦄', '🎮', '🚀', '⭐', '💎', '🏆', '👑', '🎸', '🎲'];

  const handleSaveEmail = async (email: string) => {
    const { supabase } = await import('../lib/supabase');
    await supabase.from('players').update({ email: email.trim().toLowerCase() || null }).eq('name', myName!);
    setEditingEmail(false);
  };

  const handleSaveEmoji = async (emoji: string) => {
    const { supabase } = await import('../lib/supabase');
    await supabase.from('players').update({ emoji: emoji || null }).eq('name', myName!);
    await loadPlayers();
    setShowEmojiPicker(false);
  };

  // Save the chosen shirt size to the player row. Empty string clears it.
  const handleSaveShirtSize = async (size: string) => {
    if (!myName) return;
    setSavingShirt(true);
    try {
      const { supabase } = await import('../lib/supabase');
      await supabase.from('players').update({ shirt_size: size || null }).eq('name', myName);
      await loadPlayers();
    } finally {
      setSavingShirt(false);
    }
  };

  // Resize an uploaded image to a small JPEG (~200×200 covered, ~10-30KB).
  // Done client-side so the upload payload is tiny and display is instant.
  // Upload an avatar to the 'avatars' bucket and store the public URL on the
  // player's row. The filename is keyed off player name so each player has one
  // slot they overwrite when they re-upload. A cache-busting `?v=<ts>` query
  // string is appended so the new photo replaces the old one in the UI.
  const handleAvatarFile = async (file: File) => {
    if (!myName) return;
    setAvatarError(null);
    setUploadingAvatar(true);
    try {
      await uploadAvatarFor(myName, file);
      await loadPlayers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setAvatarError(message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!myName) return;
    if (!window.confirm('Remove your profile photo?')) return;
    setUploadingAvatar(true);
    setAvatarError(null);
    try {
      await removeAvatarFor(myName);
      await loadPlayers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Remove failed';
      setAvatarError(message);
    } finally {
      setUploadingAvatar(false);
    }
  };
  
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');

  const resetPinState = () => {
    setChangePinStep(null);
    setCurrentPin(''); setNewPin(''); setConfirmPin(''); setPinError('');
  };

  const closeModal = () => { setShowModal(false); resetPinState(); };

  // Auto-advance on 4 digits
  const handleCurrentPin = async (p: string) => {
    setCurrentPin(p); setPinError('');
    if (p.length === 4 && myName) {
      const ok = await loginWithPin(myName, p);
      if (ok) { setChangePinStep('new'); setCurrentPin(''); }
      else { setPinError('Incorrect PIN. Please try again.'); setCurrentPin(''); }
    }
  };

  const handleNewPin = (p: string) => {
    setNewPin(p);
    if (p.length === 4) setChangePinStep('confirm');
  };

  const handleConfirmPin = async (p: string) => {
    setConfirmPin(p); setPinError('');
    if (p.length === 4) {
      if (p !== newPin) {
        setPinError('PINs do not match. Try again.');
        setConfirmPin(''); setNewPin(''); setChangePinStep('new');
        return;
      }
      if (myName) {
        await setupPin(myName, newPin);
        closeModal();
      }
    }
  };

  return (
    <>
    <div className="px-4 pt-10 pb-3 sticky top-0 z-50 backdrop-blur-xl" style={{ background: 'transparent' }}>
      <div
        className="rounded-2xl px-4 py-3 border flex items-center justify-between mb-2"
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, transparent), rgba(255,255,255,0.03) 45%, color-mix(in srgb, var(--accent-2) 8%, transparent))',
          borderColor: 'rgba(251, 146, 60, 0.4)',
          boxShadow: '0 0 10px rgba(251, 146, 60, 0.5), 0 0 24px rgba(251, 146, 60, 0.2)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="app-name-animated flex items-center gap-2">
          <img src="/17136e7b-a3eb-407f-a161-d5cc2705afab.png" alt="Badminton Boys" className="w-7 h-7 rounded-md flex-shrink-0 object-contain" />
          <span
            className="text-xl font-black tracking-[0.15em] uppercase bg-clip-text text-transparent"
            style={{
              backgroundImage: 'linear-gradient(90deg, var(--accent-from), var(--accent), var(--accent-2))',
              filter: 'drop-shadow(0 2px 10px color-mix(in srgb, var(--accent) 30%, transparent))',
            }}>
            Badminton Boys
          </span>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 bg-slate-900/40 border border-slate-800/80 rounded-xl px-2.5 py-1 hover:border-violet-500/50 transition-colors backdrop-blur-md"
          title="Profile"
        >
<div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 shadow-inner overflow-hidden"
            style={{
              background: currentPlayer?.color?.bg || '#1e293b',
              color: currentPlayer?.color?.fg || '#94a3b8',
              fontSize: currentPlayer?.emoji ? 16 : undefined,
            }}
          >
            {currentPlayer?.avatar_url ? (
              <img
                src={currentPlayer.avatar_url}
                alt={myName || ''}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              currentPlayer?.emoji || initials
            )}
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden sm:inline">
            {myName ? 'Profile' : 'Switch'}
          </span>
        </button>
      </div>

     {showAdmins && <AdminPills settings={settings} />}
    </div>

      {/* Profile Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, overflowY: 'auto',
          }}
          onClick={closeModal}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0f172a', border: '1px solid #1e293b',
              borderRadius: 20, padding: 24, width: '100%', maxWidth: 320,
              display: 'flex', flexDirection: 'column', gap: 16,
              margin: 'auto', position: 'relative',
            }}
          >
     {/* Player info */}
     {myName && currentPlayer && (
              <div style={{ paddingBottom: 16, borderBottom: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  {/* Avatar with emoji picker — shows uploaded photo first,
                      falling back to emoji, then initials. */}
                  <button
                    onClick={() => setShowEmojiPicker(v => !v)}
                    style={{
                      width: 56, height: 56, borderRadius: 16,
                      background: currentPlayer.avatar_url ? '#0f172a' : currentPlayer.color.bg,
                      color: currentPlayer.color.fg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: currentPlayer.emoji ? 28 : 18,
                      fontWeight: 700, border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                      cursor: 'pointer', flexShrink: 0, position: 'relative',
                      overflow: 'hidden', padding: 0,
                    }}
                    title="Change emoji"
                  >
                    {currentPlayer.avatar_url ? (
                      <img
                        src={currentPlayer.avatar_url}
                        alt={myName}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <>{currentPlayer.emoji || initials}</>
                    )}
                    <span style={{
                      position: 'absolute', bottom: -4, right: -4,
                      background: '#1e293b', borderRadius: '50%',
                      width: 18, height: 18, fontSize: 10,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '1px solid #334155',
                    }}>✏️</span>
                  </button>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{myName}</div>
                    {/* Skill badge */}
                    {currentPlayer.skill && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px',
                        borderRadius: 20, marginTop: 4, display: 'inline-block',
                        background: currentPlayer.skill === 'E' ? 'color-mix(in srgb, var(--accent) 15%, transparent)' :
                                    currentPlayer.skill === 'I' ? 'rgba(45,212,191,0.15)' :
                                    'rgba(251,191,36,0.15)',
                        color: currentPlayer.skill === 'E' ? 'var(--accent)' :
                               currentPlayer.skill === 'I' ? '#2dd4bf' : '#fbbf24',
                        border: `1px solid ${currentPlayer.skill === 'E' ? 'color-mix(in srgb, var(--accent) 30%, transparent)' :
                                              currentPlayer.skill === 'I' ? 'rgba(45,212,191,0.3)' :
                                              'rgba(251,191,36,0.3)'}`,
                      }}>
                        {currentPlayer.skill === 'E' ? '⭐ Experienced' :
                         currentPlayer.skill === 'I' ? '🏸 Intermediate' : '🌱 Beginner'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Emoji picker */}
                {showEmojiPicker && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 8,
                    background: '#1e293b', borderRadius: 12, padding: 12,
                    marginBottom: 8, border: '1px solid #334155',
                  }}>
                    {EMOJIS.map(e => (
                      <button
                        key={e}
                        onClick={() => handleSaveEmoji(e)}
                        style={{
                          fontSize: 24, border: 'none',
                          cursor: 'pointer', padding: 4, borderRadius: 8,
                          background: currentPlayer.emoji === e ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                        }}
                      >{e}</button>
                    ))}
                    <button
                      onClick={() => handleSaveEmoji('')}
                      style={{
                        fontSize: 10, color: '#475569', background: 'none',
                        border: '1px solid #334155', cursor: 'pointer',
                        padding: '4px 8px', borderRadius: 8, alignSelf: 'center',
                      }}
                    >Reset</button>
                  </div>
                )}

                {/* Profile photo controls */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label
                      style={{
                        flex: 1, padding: '8px 12px', borderRadius: 10,
                        background: '#1e293b', border: '1px solid #334155',
                        color: '#cbd5e1', fontSize: 12, fontWeight: 600,
                        cursor: uploadingAvatar ? 'wait' : 'pointer', textAlign: 'center',
                        opacity: uploadingAvatar ? 0.6 : 1,
                      }}
                    >
                      {uploadingAvatar
                        ? '⏳ Uploading…'
                        : currentPlayer.avatar_url ? '📷 Change photo' : '📷 Upload photo'}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingAvatar}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) handleAvatarFile(f);
                          // Reset so picking the same file again still fires onChange
                          e.target.value = '';
                        }}
                        style={{ display: 'none' }}
                      />
                    </label>
                    {currentPlayer.avatar_url && !uploadingAvatar && (
                      <button
                        onClick={handleRemoveAvatar}
                        style={{
                          padding: '8px 12px', borderRadius: 10,
                          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)',
                          color: '#f87171', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >Remove</button>
                    )}
                  </div>
                  {avatarError && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#f87171' }}>
                      ⚠️ {avatarError}
                    </div>
                  )}
                </div>

                {/* Shirt size — collapsed to a summary row; expand to pick */}
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => setShirtOpen(o => !o)} style={settingRowStyle}>
                    <span style={settingLabelStyle}>Shirt size</span>
                    <span style={settingValueStyle}>
                      {currentPlayer.shirt_size || 'Not set'}
                      <span style={{ fontSize: 10 }}>{shirtOpen ? '▲' : '▼'}</span>
                    </span>
                  </button>
                  {shirtOpen && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0 10px' }}>
                      {(['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const).map(s => {
                        const active = currentPlayer.shirt_size === s;
                        return (
                          <button
                            key={s}
                            onClick={() => handleSaveShirtSize(s)}
                            disabled={savingShirt}
                            style={{
                              flex: '1 1 auto', minWidth: 40, padding: '7px 10px',
                              borderRadius: 8,
                              background: active ? 'var(--accent)' : '#1e293b',
                              border: active ? '1px solid var(--accent)' : '1px solid #334155',
                              color: active ? 'var(--accent-text)' : '#94a3b8',
                              fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            }}
                          >{s}</button>
                        );
                      })}
                      {currentPlayer.shirt_size && (
                        <button
                          onClick={() => handleSaveShirtSize('')}
                          disabled={savingShirt}
                          title="Clear shirt size"
                          style={{
                            padding: '7px 10px', borderRadius: 8,
                            background: 'transparent', border: '1px solid #334155',
                            color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          }}
                        >✕</button>
                      )}
                    </div>
                  )}
                </div>

                {/* Email */}
                <div style={{ marginTop: 4 }}>
                  {editingEmail ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="email"
                        value={emailDraft}
                        onChange={e => setEmailDraft(e.target.value)}
                        placeholder="your@email.com"
                        autoFocus
                        style={{
                          flex: 1, background: '#1e293b', border: '1px solid #334155',
                          borderRadius: 8, padding: '6px 10px', color: '#f1f5f9',
                          fontSize: 13, outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => handleSaveEmail(emailDraft)}
                        style={{
                          background: 'var(--accent)', color: '#fff', border: 'none',
                          borderRadius: 8, padding: '6px 10px', fontSize: 12,
                          fontWeight: 700, cursor: 'pointer',
                        }}
                      >Save</button>
                      <button
                        onClick={() => setEditingEmail(false)}
                        style={{
                          background: '#1e293b', color: '#94a3b8', border: '1px solid #334155',
                          borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                        }}
                      >✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEmailDraft(currentPlayer.email ?? ''); setEditingEmail(true); }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6, padding: 0,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>📧</span>
                      <span style={{
                        fontSize: 12, color: currentPlayer.email ? '#94a3b8' : '#475569',
                        textDecoration: 'underline', textDecorationStyle: 'dotted',
                      }}>
                        {currentPlayer.email ?? 'Add email address'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Theme picker — collapsed to a summary row showing the active
                theme; expand to see the swatches. Saved in localStorage so each
                device remembers its choice. */}
            {changePinStep === null && (
              <div>
                <button onClick={() => setThemeOpen(o => !o)} style={settingRowStyle}>
                  <span style={settingLabelStyle}>Theme</span>
                  <span style={{ ...settingValueStyle, color: themeOpen ? 'var(--accent)' : '#8b93a7' }}>
                    {THEMES.find(t => t.id === activeTheme)?.label ?? 'Default'}
                    <span style={{ fontSize: 10 }}>{themeOpen ? '▲' : '▼'}</span>
                  </span>
                </button>
                {themeOpen && (
                  <div style={{ display: 'flex', gap: 8, padding: '4px 0 10px' }}>
                    {THEMES.map(theme => (
                      <button
                        key={theme.id}
                        onClick={() => handleThemeChange(theme.id)}
                        title={theme.label}
                        style={{
                          flex: 1, height: 48, borderRadius: 10,
                          background: theme.swatchGradient,
                          border: activeTheme === theme.id ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
                          cursor: 'pointer', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', padding: 0,
                          boxShadow: activeTheme === theme.id ? '0 0 10px color-mix(in srgb, var(--accent) 45%, transparent)' : 'none',
                        }}
                      >
                        <span style={{ fontSize: 17, lineHeight: 1 }}>{theme.emoji}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Manage tabs — show/hide tabs from the bottom nav */}
            {changePinStep === null && (
              <div>
                <button onClick={() => setTabsOpen(o => !o)} style={settingRowStyle}>
                  <span style={settingLabelStyle}>Manage tabs</span>
                  <span style={{ ...settingValueStyle, color: tabsOpen ? 'var(--accent)' : '#8b93a7' }}>
                    {hiddenTabs.length} hidden
                    <span style={{ fontSize: 10 }}>{tabsOpen ? '▲' : '▼'}</span>
                  </span>
                </button>
                {tabsOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0 10px' }}>
                    {TAB_MANAGEMENT.map(tab => {
                      const visible = !hiddenTabs.includes(tab.id);
                      return (
                        <button
                          key={tab.id}
                          onClick={() => toggleTabVisibility(tab.id)}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 12px', borderRadius: 8,
                            background: visible ? '#1e293b' : '#0f172a',
                            border: visible ? '1px solid #334155' : '1px solid #1e293b',
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontSize: 12, color: visible ? '#cbd5e1' : '#475569', fontWeight: 500 }}>
                            {tab.icon} {tab.label}
                          </span>
                          <span style={{
                            width: 36, height: 20, borderRadius: 10,
                            background: visible ? 'var(--accent)' : '#334155',
                            position: 'relative', transition: 'background 0.2s',
                            flexShrink: 0,
                          }}>
                            <span style={{
                              position: 'absolute', top: 2, left: visible ? 18 : 2,
                              width: 16, height: 16, borderRadius: '50%',
                              background: '#fff', transition: 'left 0.2s',
                            }} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Change PIN flow */}
            {changePinStep === null && (
              <>
                <button
                  onClick={() => { setPinError(''); setChangePinStep('current'); }}
                  style={settingRowStyle}
                >
                  <span style={settingLabelStyle}>Change PIN</span>
                  <span style={{ ...settingValueStyle, fontSize: 11 }}>›</span>
                </button>
                <button
                  onClick={() => {
                    if (!window.confirm('Log out?')) return;
                    closeModal();
                    logout();
                  }}
                  style={{
                    width: '100%', padding: '10px 16px', borderRadius: 10, marginTop: 12,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)',
                    color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  Log out
                </button>
              </>
            )}

            {changePinStep === 'current' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>Enter current PIN</div>
                {pinError && <div style={{ fontSize: 12, color: '#f87171', textAlign: 'center' }}>{pinError}</div>}
                <PinPad pin={currentPin} onChange={handleCurrentPin} />
                <button onClick={resetPinState} style={{ fontSize: 12, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                <div style={{ fontSize: 11, color: '#374151', textAlign: 'center' }}>
                  Forgot your PIN? Ask an admin to reset it for you.
                </div>
              </div>
            )}

            {changePinStep === 'new' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>Enter new PIN</div>
                <PinPad pin={newPin} onChange={handleNewPin} />
                <button onClick={resetPinState} style={{ fontSize: 12, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
              </div>
            )}

            {changePinStep === 'confirm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>Confirm new PIN</div>
                {pinError && <div style={{ fontSize: 12, color: '#f87171', textAlign: 'center' }}>{pinError}</div>}
                <PinPad pin={confirmPin} onChange={handleConfirmPin} />
                <button onClick={resetPinState} style={{ fontSize: 12, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AdminPills({ settings }: { settings: Record<string, string> }) {
  const admin1 = settings.admin1 || 'Eswar';
  const admin2 = settings.admin2 || 'Arun';
  const av1 = admin1.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  const av2 = admin2.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="flex gap-2">
      <div className="flex-1 flex items-center gap-2.5 rounded-2xl p-3 border backdrop-blur-md transition-all duration-300 hover:scale-[1.02]"
        style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), rgba(255,255,255,0.025) 45%, color-mix(in srgb, var(--accent-2) 6%, transparent))', borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)', boxShadow: '0 0 10px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 20px color-mix(in srgb, var(--accent) 15%, transparent)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-violet-500/10 text-violet-400 text-xs font-black tracking-wider border border-violet-500/25 flex-shrink-0">{av1}</div>
        <div>
          <div className="text-xs font-bold text-slate-200 tracking-wide">{admin1}</div>
          <div className="text-[9px] text-violet-400 font-extrabold tracking-[0.15em] uppercase mt-0.5">Admin</div>
        </div>
      </div>
      <div className="flex-1 flex items-center gap-2.5 rounded-2xl p-3 border backdrop-blur-md transition-all duration-300 hover:scale-[1.02]"
        style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), rgba(255,255,255,0.025) 45%, color-mix(in srgb, var(--accent-2) 6%, transparent))', borderColor: 'color-mix(in srgb, var(--accent-from) 25%, transparent)', boxShadow: '0 0 10px color-mix(in srgb, var(--accent-from) 40%, transparent), 0 0 20px color-mix(in srgb, var(--accent-from) 15%, transparent)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-rose-500/10 text-rose-400 text-xs font-black tracking-wider border border-rose-500/25 flex-shrink-0">{av2}</div>
        <div>
          <div className="text-xs font-bold text-slate-200 tracking-wide">{admin2}</div>
          <div className="text-[9px] text-rose-400 font-extrabold tracking-[0.15em] uppercase mt-0.5">Admin</div>
        </div>
      </div>
    </div>
  );
}