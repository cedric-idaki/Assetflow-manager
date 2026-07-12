import React, { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import Icon from '../../../components/AppIcon';
import { Card, Table, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput, Select, EmptyState, fmtDate } from './_shared';

const MEMBER_ROLES = ['member', 'treasurer', 'chairman', 'secretary', 'auditor'];
const STATUSES = ['active', 'inactive', 'suspended'];

const emptyForm = {
  full_name: '', phone: '', email: '', national_id: '', gender: '',
  member_role: 'member', status: 'active', kyc_status: 'pending',
  next_of_kin_name: '', next_of_kin_relationship: '', next_of_kin_phone: '', next_of_kin_id: '',
};

// Strong temporary password: >= 8 chars, one of each class, no ambiguous chars
// (same generator as the client-portal provisioning flow).
const generatePassword = () => {
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789', SY = '@#$%';
  let password = pick(U) + pick(L) + pick(D) + pick(SY);
  for (let i = 0; i < 8; i++) password += pick(U + L + D + SY);
  return password;
};

const MembersTab = ({ ctx }) => {
  const { members, addMember, updateMember, exportCSV, refreshMembers } = ctx;
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

  // "Create login" / "Reset password" flow state
  const [loginFor, setLoginFor] = useState(null);      // member being provisioned
  const [loginMode, setLoginMode] = useState('create'); // 'create' | 'reset'
  const [loginEmail, setLoginEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState(null); // { email, password } shown once

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (m) => { setEditing(m); setForm({ ...emptyForm, ...m }); setOpen(true); };

  const openCreateLogin = (m) => {
    setLoginFor(m);
    setLoginMode('create');
    setLoginEmail(m.email || '');
    setCredentials(null);
  };

  const openResetLogin = (m) => {
    setLoginFor(m);
    setLoginMode('reset');
    setLoginEmail(m.email || '');
    setCredentials(null);
  };

  const callAuthFunction = async (body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('No active session.');
    const rawUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}.supabase.co`;
    const res = await fetch(`${supabaseUrl}/functions/v1/create-staff-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || 'Request failed');
    return json;
  };

  const createLogin = async () => {
    const email = loginEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast.error('A valid email is required for the login.'); return; }
    setCreating(true);
    try {
      const password = generatePassword();
      await callAuthFunction({
        email, password,
        full_name: loginFor.full_name,
        role: 'sacco_member',
        phone: loginFor.phone || '',
        admin_id: user?.id,
        sacco_member_id: loginFor.id,
      });
      // IMPORTANT: refresh only the members list. A full refetch() would flip
      // the dashboard into its loading skeleton, unmount this tab and destroy
      // the credentials modal before the password can be read.
      setCredentials({ email, password });
      toast.success('Member login created.');
      refreshMembers();
    } catch (e) {
      toast.error(e.message || 'Could not create the login.');
    } finally {
      setCreating(false);
    }
  };

  const resetLogin = async () => {
    setCreating(true);
    try {
      const password = generatePassword();
      const json = await callAuthFunction({
        action: 'reset-password',
        sacco_member_id: loginFor.id,
        password,
      });
      setCredentials({ email: json.email || loginFor.email, password });
      toast.success('Password reset.');
    } catch (e) {
      toast.error(e.message || 'Could not reset the password.');
    } finally {
      setCreating(false);
    }
  };

  const copyCredentials = () => {
    navigator.clipboard?.writeText(`Portal: ${window.location.origin}\nEmail: ${credentials.email}\nPassword: ${credentials.password}`);
    toast.success('Credentials copied to clipboard.');
  };

  const save = async () => {
    if (!form.full_name.trim()) { toast.error('Member name is required.'); return; }
    setSaving(true);
    try {
      if (editing) await updateMember(editing.id, form);
      else await addMember(form);
      toast.success(editing ? 'Member updated.' : 'Member added.');
      setOpen(false);
    } catch (e) {
      toast.error(e.message || 'Could not save member.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = members.filter((m) =>
    !q || (m.full_name || '').toLowerCase().includes(q.toLowerCase()) || (m.member_no || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <Card
      title="Members"
      subtitle={`${members.length} registered · ${members.filter((m) => m.status === 'active').length} active`}
      actions={
        <div className="flex items-center gap-2">
          <GhostButton icon="Download" onClick={() => exportCSV(members, 'sacco_members')}>Export</GhostButton>
          <PrimaryButton icon="UserPlus" onClick={openNew}>Add member</PrimaryButton>
        </div>
      }
    >
      <input
        value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or member no…"
        className="w-full sm:w-72 mb-4 px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
      />

      {filtered.length === 0 ? (
        <EmptyState icon="Users" title="No members yet" hint="Add your first member to start tracking contributions, loans and shares." />
      ) : (
        <Table columns={['Member', 'Role', 'Phone', 'Status', 'KYC', 'Portal', 'Joined', '']}>
          {filtered.map((m) => (
            <tr key={m.id} className="border-b border-border/60">
              <td className="py-2.5 pr-4">
                <p className="font-medium text-foreground">{m.full_name}</p>
                <p className="text-xs text-muted-foreground">{m.member_no}</p>
              </td>
              <td className="py-2.5 pr-4 capitalize text-foreground">{m.member_role}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{m.phone || '—'}</td>
              <td className="py-2.5 pr-4"><Badge status={m.status} /></td>
              <td className="py-2.5 pr-4"><Badge status={m.kyc_status} /></td>
              <td className="py-2.5 pr-4">
                {m.user_id ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <Icon name="KeyRound" size={12} color="currentColor" /> Has login
                    </span>
                    <button onClick={() => openResetLogin(m)} className="text-left text-xs text-primary font-semibold hover:underline">
                      Reset password
                    </button>
                  </div>
                ) : (
                  <button onClick={() => openCreateLogin(m)} className="text-xs text-primary font-semibold hover:underline">
                    Create login
                  </button>
                )}
              </td>
              <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(m.joined_at)}</td>
              <td className="py-2.5 pr-0 text-right">
                <button onClick={() => openEdit(m)} className="text-xs text-primary font-semibold hover:underline">Edit</button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={open} onClose={() => setOpen(false)} wide
        title={editing ? 'Edit member' : 'Add member'}
        footer={<>
          <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save member'}</PrimaryButton>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name *"><TextInput value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Jane Wanjiku" /></Field>
          <Field label="Phone"><TextInput value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254 7XX XXX XXX" /></Field>
          <Field label="Email"><TextInput value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="jane@example.com" /></Field>
          <Field label="National ID"><TextInput value={form.national_id} onChange={(e) => set('national_id', e.target.value)} /></Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="">Select gender…</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </Select>
          </Field>
          <Field label="Role"><Select value={form.member_role} onChange={(e) => set('member_role', e.target.value)}>{MEMBER_ROLES.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}</Select></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        </div>
        <p className="text-xs font-semibold text-muted-foreground mt-5 mb-2 uppercase tracking-wide">Next of kin</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name"><TextInput value={form.next_of_kin_name} onChange={(e) => set('next_of_kin_name', e.target.value)} /></Field>
          <Field label="Relationship"><TextInput value={form.next_of_kin_relationship} onChange={(e) => set('next_of_kin_relationship', e.target.value)} /></Field>
          <Field label="Phone"><TextInput value={form.next_of_kin_phone} onChange={(e) => set('next_of_kin_phone', e.target.value)} /></Field>
          <Field label="ID number"><TextInput value={form.next_of_kin_id} onChange={(e) => set('next_of_kin_id', e.target.value)} /></Field>
        </div>
      </Modal>

      {/* Create portal login / reset password for a member */}
      <Modal
        open={!!loginFor} onClose={() => setLoginFor(null)}
        title={credentials
          ? (loginMode === 'reset' ? 'New password ready' : 'Login created')
          : (loginMode === 'reset' ? `Reset password — ${loginFor?.full_name || ''}` : `Create portal login — ${loginFor?.full_name || ''}`)}
        footer={credentials ? (
          <PrimaryButton icon="Check" onClick={() => setLoginFor(null)}>Done</PrimaryButton>
        ) : (
          <>
            <GhostButton onClick={() => setLoginFor(null)}>Cancel</GhostButton>
            <PrimaryButton icon="KeyRound" onClick={loginMode === 'reset' ? resetLogin : createLogin} disabled={creating}>
              {creating
                ? (loginMode === 'reset' ? 'Resetting…' : 'Creating…')
                : (loginMode === 'reset' ? 'Generate new password' : 'Create login')}
            </PrimaryButton>
          </>
        )}
      >
        {credentials ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <Icon name="CheckCircle2" size={20} color="#059669" />
              <p className="text-sm text-foreground">
                Share these credentials with the member. The password is shown <strong>only once</strong> —
                copy it before closing this window.
              </p>
            </div>
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Email:</span> <span className="font-mono text-foreground">{credentials.email}</span></p>
              <p><span className="text-muted-foreground">Password:</span> <span className="font-mono text-foreground">{credentials.password}</span></p>
            </div>
            <GhostButton icon="Copy" onClick={copyCredentials}>Copy credentials</GhostButton>
          </div>
        ) : loginMode === 'reset' ? (
          <p className="text-sm text-muted-foreground">
            This generates a <strong className="text-foreground">new temporary password</strong> for{' '}
            <strong className="text-foreground">{loginFor?.full_name}</strong>
            {loginEmail ? <> (login: <span className="font-mono">{loginEmail}</span>)</> : null}.
            Their old password stops working immediately.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The member signs in with this email and a generated temporary password, and
              gets their own portal: contributions, loans, shares, voting, contracts and documents.
            </p>
            <Field label="Login email *">
              <TextInput value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="member@example.com" />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
};

export default MembersTab;
