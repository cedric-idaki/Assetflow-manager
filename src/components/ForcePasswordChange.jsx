import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import Icon from './AppIcon';

// Global first-login gate, mounted in MainLayout so it covers every portal
// (staff dashboards, client portal, sales agent portal, sacco member portal).
//
// Accounts provisioned by an admin — via the create-staff-user Edge Function
// or the /auth/v1/signup invite flows — carry user_metadata.must_change_password
// = true. The emailed/typed password is temporary: the user cannot use the app
// until they replace it with their own.
const ForcePasswordChange = () => {
  const { user } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!user?.user_metadata?.must_change_password || done) return null;

  const submit = async () => {
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw !== confirm) { setError('The passwords do not match.'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.auth.updateUser({
      password: pw,
      data: { must_change_password: false },
    });
    setSaving(false);
    if (err) { setError(err.message || 'Could not update the password.'); return; }
    setDone(true);
  };

  return (
    /* deliberately not dismissable — the temporary password must be replaced */
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Icon name="ShieldAlert" size={18} color="#ca8a04" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Set your own password</h3>
            <p className="text-xs text-muted-foreground">Required before you can continue</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <Icon name="KeyRound" size={18} color="#ca8a04" />
            <p className="text-sm text-foreground">
              You signed in with a <strong>temporary password</strong>. Choose your own password to
              secure your account.
            </p>
          </div>

          <label className="block">
            <span className="block text-xs font-semibold mb-1.5 text-foreground">New password (min. 8 characters)</span>
            <input
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-semibold mb-1.5 text-foreground">Confirm new password</span>
            <input
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Show passwords
          </label>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end p-4 border-t border-border">
          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60 bg-primary hover:opacity-90"
          >
            <Icon name="KeyRound" size={15} color="currentColor" />
            {saving ? 'Saving…' : 'Save password & continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ForcePasswordChange;
