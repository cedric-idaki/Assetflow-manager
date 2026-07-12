import React, { useState, useEffect } from 'react';
import { useToast } from '../../../components/Toast';
import {
  Card, Badge, PrimaryButton, Field, TextInput, fmtDate,
} from '../../sacco-dashboard/components/_shared';

const EDITABLE = [
  'phone', 'email',
  'next_of_kin_name', 'next_of_kin_relationship', 'next_of_kin_phone', 'next_of_kin_id',
];

// BRS FR1.2 — members manage their own contact details and next of kin.
// Membership number, role, status and KYC are read-only (admin-managed).
const ProfileTab = ({ ctx }) => {
  const { me, updateProfile } = ctx;
  const toast = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (me) setForm(EDITABLE.reduce((acc, k) => ({ ...acc, [k]: me[k] || '' }), {}));
  }, [me]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success('Profile updated.');
    } catch (e) {
      toast.error(e.message || 'Could not update your profile.');
    } finally {
      setSaving(false);
    }
  };

  if (!me) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card title="Membership" className="lg:col-span-1">
        <div className="space-y-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Full name</p><p className="font-semibold text-foreground">{me.full_name}</p></div>
          <div><p className="text-xs text-muted-foreground">Member number</p><p className="font-mono text-foreground">{me.member_no || '—'}</p></div>
          <div><p className="text-xs text-muted-foreground">Role</p><p className="capitalize text-foreground">{me.member_role}</p></div>
          <div className="flex items-center gap-4">
            <div><p className="text-xs text-muted-foreground mb-1">Status</p><Badge status={me.status} /></div>
            <div><p className="text-xs text-muted-foreground mb-1">KYC</p><Badge status={me.kyc_status} /></div>
          </div>
          <div><p className="text-xs text-muted-foreground">Member since</p><p className="text-foreground">{fmtDate(me.joined_at)}</p></div>
          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
            These details are managed by your sacco administrator.
          </p>
        </div>
      </Card>

      <Card
        title="Contact & next of kin"
        subtitle="You can update these yourself"
        className="lg:col-span-2"
        actions={<PrimaryButton icon="Check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Phone"><TextInput value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} placeholder="+254 7XX XXX XXX" /></Field>
          <Field label="Contact email"><TextInput value={form.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
        </div>
        <p className="text-xs font-semibold text-muted-foreground mt-5 mb-2 uppercase tracking-wide">Next of kin</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name"><TextInput value={form.next_of_kin_name || ''} onChange={(e) => set('next_of_kin_name', e.target.value)} /></Field>
          <Field label="Relationship"><TextInput value={form.next_of_kin_relationship || ''} onChange={(e) => set('next_of_kin_relationship', e.target.value)} /></Field>
          <Field label="Phone"><TextInput value={form.next_of_kin_phone || ''} onChange={(e) => set('next_of_kin_phone', e.target.value)} /></Field>
          <Field label="ID number"><TextInput value={form.next_of_kin_id || ''} onChange={(e) => set('next_of_kin_id', e.target.value)} /></Field>
        </div>
      </Card>
    </div>
  );
};

export default ProfileTab;
