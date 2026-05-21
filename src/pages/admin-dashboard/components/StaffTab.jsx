import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { formatKEPhone } from '../../../utils/phoneUtils';

const STAFF_ROLES = [
  { value: 'director',            label: 'Director',            color: 'bg-indigo-100 text-indigo-700' },
  { value: 'accountant',          label: 'Accountant',          color: 'bg-cyan-100 text-cyan-700' },
  { value: 'collections_officer', label: 'Collections Officer', color: 'bg-orange-100 text-orange-700' },
  { value: 'manager',             label: 'Manager',             color: 'bg-teal-100 text-teal-700' },
  { value: 'finance',             label: 'Finance',             color: 'bg-green-100 text-green-700' },
  { value: 'operations',          label: 'Operations',          color: 'bg-yellow-100 text-yellow-700' },
  { value: 'sales_agent',         label: 'Sales Agent',         color: 'bg-emerald-100 text-emerald-700' },
];

const getRoleStyle = (role) => STAFF_ROLES.find(r => r.value === role)?.color || 'bg-gray-100 text-gray-600';
const getRoleLabel = (role) => STAFF_ROLES.find(r => r.value === role)?.label || (role || '').replace(/_/g,' ');

const Avatar = ({ name }) => {
  const initials = (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['bg-blue-500','bg-purple-500','bg-emerald-500','bg-orange-500','bg-pink-500','bg-teal-500'];
  const color  = colors[(name || '').charCodeAt(0) % colors.length];
  return (
    <div className={`w-9 h-9 ${color} rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
};

const Toast = ({ message, type, onClose }) => (
  <div className={`fixed bottom-6 right-6 z-[300] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium
    ${type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
    <Icon name={type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={16} color="white" />
    {message}
    <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><Icon name="X" size={14} color="white" /></button>
  </div>
);

// ── InviteModal defined OUTSIDE StaffTab to prevent focus loss ────────────────
const InviteModal = ({ onClose, onInvite, subscription, currentStaffCount }) => {
  const maxUsers  = subscription?.plan?.max_users || subscription?.max_users || null;
  const slotsLeft = maxUsers ? maxUsers - currentStaffCount : null;

  const [form, setForm] = useState({
    full_name: '', email: '', role: 'operations',
    phone: '', department: '', password: '', confirm_password: '',
  });
  const [errors, setErrors]   = useState({});
  const [loading, setLoading] = useState(false);

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    setErrors(p => ({ ...p, [k]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.full_name.trim()) e.full_name = 'Full name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email address';
    if (!form.role) e.role = 'Role is required';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 8) e.password = 'Minimum 8 characters';
    if (form.password !== form.confirm_password) e.confirm_password = 'Passwords do not match';
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    if (slotsLeft !== null && slotsLeft <= 0) return;
    setLoading(true);
    try {
      await onInvite(form);
      onClose();
    } catch (err) {
      setErrors({ submit: err.message || 'Failed to create staff member' });
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (k) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 bg-background text-foreground
    ${errors[k] ? 'border-red-400' : 'border-border'}`;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Add Staff Member</h2>
              <p className="text-xs text-muted-foreground">
                {slotsLeft !== null
                  ? `${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} remaining on your plan`
                  : 'No limit on this plan'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Quota warning */}
          {slotsLeft !== null && slotsLeft <= 2 && slotsLeft > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs">
              <Icon name="AlertTriangle" size={14} color="#ca8a04" />
              Only {slotsLeft} staff slot{slotsLeft !== 1 ? 's' : ''} left on your plan. Consider upgrading.
            </div>
          )}
          {slotsLeft !== null && slotsLeft <= 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <Icon name="XCircle" size={14} color="#dc2626" />
              Staff limit reached. Please upgrade your subscription to add more users.
            </div>
          )}
          {errors.submit && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <Icon name="AlertCircle" size={14} color="currentColor" />
              {errors.submit}
            </div>
          )}

          {/* Full Name + Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Full Name *</label>
              <input
                type="text"
                value={form.full_name}
                placeholder="e.g. Jane Wanjiru"
                onChange={e => set('full_name', e.target.value)}
                className={inputClass('full_name')}
              />
              {errors.full_name && <p className="mt-1 text-xs text-red-500">{errors.full_name}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Email Address *</label>
              <input
                type="email"
                value={form.email}
                placeholder="jane@company.com"
                onChange={e => set('email', e.target.value)}
                className={inputClass('email')}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Role *</label>
            <select
              value={form.role}
              onChange={e => set('role', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 bg-background text-foreground"
            >
              {STAFF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {/* Phone + Department */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                placeholder="+254 7XX XXX XXX"
                onChange={e => set('phone', formatKEPhone(e.target.value))}
                className={inputClass('phone')}
              />
              {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Department</label>
              <input
                type="text"
                value={form.department}
                placeholder="e.g. Finance"
                onChange={e => set('department', e.target.value)}
                className={inputClass('department')}
              />
              {errors.department && <p className="mt-1 text-xs text-red-500">{errors.department}</p>}
            </div>
          </div>

          {/* Password + Confirm */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Password *</label>
              <input
                type="password"
                value={form.password}
                placeholder="Min 8 characters"
                onChange={e => set('password', e.target.value)}
                className={inputClass('password')}
              />
              {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Confirm Password *</label>
              <input
                type="password"
                value={form.confirm_password}
                placeholder="Repeat password"
                onChange={e => set('confirm_password', e.target.value)}
                className={inputClass('confirm_password')}
              />
              {errors.confirm_password && <p className="mt-1 text-xs text-red-500">{errors.confirm_password}</p>}
            </div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
            <Icon name="Info" size={12} color="currentColor" className="inline mr-1" />
            The staff member will receive a verification email. They can log in after verifying their account.
            Their access is limited to your company data only.
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-5">
          <button
            onClick={handleSubmit}
            disabled={loading || (slotsLeft !== null && slotsLeft <= 0)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>Creating...</>
            ) : (
              <><Icon name="UserPlus" size={15} color="white" />Add Staff Member</>
            )}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-border text-muted-foreground text-sm font-medium rounded-xl hover:bg-muted">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

const StaffTab = ({ staff = [], subscription, onInvite, onToggleActive, onExport }) => {
  const [search, setSearch]             = useState('');
  const [roleFilter, setRoleFilter]     = useState('all');
  const [showModal, setShowModal]       = useState(false);
  const [toast, setToast]               = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);

  const maxUsers     = subscription?.plan?.max_users || subscription?.max_users || null;
  const activeCount  = staff.filter(s => s.is_active !== false).length;
  const slotsLeft    = maxUsers ? maxUsers - activeCount : null;
  const usagePercent = maxUsers ? Math.min(100, Math.round((activeCount / maxUsers) * 100)) : 0;

  const showToast = (msg, type = 'success') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleInvite = async (data) => {
    await onInvite(data);
    showToast(`${data.full_name} has been added as ${getRoleLabel(data.role)}`);
  };

  const handleToggle = async (member) => {
    try {
      const newStatus = member.is_active === false ? true : false;
      await onToggleActive(member.id, newStatus);
      showToast(`${member.full_name} has been ${newStatus ? 'activated' : 'deactivated'}`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setConfirmToggle(null);
    }
  };

  const filtered = staff.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      s.full_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q);
    const matchRole = roleFilter === 'all' || s.role === roleFilter;
    return matchSearch && matchRole;
  });

  const isActive = (s) => s.is_active !== false;

  return (
    <div className="space-y-5">

      {/* Subscription quota bar */}
      {maxUsers !== null && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-foreground">Staff Quota</p>
              <p className="text-xs text-muted-foreground capitalize">
                {subscription?.plan?.name || subscription?.plan_name || 'Current'} plan ·{' '}
                {activeCount} of {maxUsers} slots used
              </p>
            </div>
            {slotsLeft !== null && (
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                slotsLeft <= 0 ? 'bg-red-100 text-red-700' :
                slotsLeft <= 2 ? 'bg-yellow-100 text-yellow-700' :
                'bg-emerald-100 text-emerald-700'
              }`}>
                {slotsLeft <= 0 ? 'Full' : `${slotsLeft} left`}
              </span>
            )}
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                usagePercent >= 100 ? 'bg-red-500' :
                usagePercent >= 80  ? 'bg-yellow-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          {slotsLeft !== null && slotsLeft <= 0 && (
            <p className="text-xs text-red-600 mt-1.5 font-medium">
              Staff limit reached. Contact your super admin to upgrade your plan.
            </p>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Icon name="Search" size={14} color="var(--color-muted-foreground)" />
          </div>
          <input
            type="text" placeholder="Search by name or email..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 bg-background text-foreground"
          />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="text-sm border border-border rounded-xl px-3 py-2 focus:outline-none bg-background text-foreground">
          <option value="all">All Roles</option>
          {STAFF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button
          onClick={() => setShowModal(true)}
          disabled={slotsLeft !== null && slotsLeft <= 0}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="UserPlus" size={15} color="white" />
          Add Staff
        </button>
        <button
          onClick={() => onExport(staff.map(s => ({
            name: s.full_name, email: s.email, role: getRoleLabel(s.role),
            department: s.department, status: isActive(s) ? 'Active' : 'Inactive',
          })), 'staff_list')}
          className="flex items-center gap-2 px-3 py-2 border border-border text-sm font-medium text-muted-foreground rounded-xl hover:bg-muted transition-colors whitespace-nowrap"
        >
          <Icon name="Download" size={14} color="currentColor" />
          Export
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Staff', value: staff.length,                           icon: 'Users',     bg: 'bg-blue-50',    ic: '#3b82f6' },
          { label: 'Active',      value: staff.filter(s => isActive(s)).length,  icon: 'UserCheck', bg: 'bg-emerald-50', ic: '#10b981' },
          { label: 'Inactive',    value: staff.filter(s => !isActive(s)).length, icon: 'UserX',     bg: 'bg-red-50',     ic: '#ef4444' },
          { label: 'Roles',       value: [...new Set(staff.map(s => s.role))].length, icon: 'Shield', bg: 'bg-purple-50', ic: '#8b5cf6' },
        ].map((s, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.bg}`}>
              <Icon name={s.icon} size={16} color={s.ic} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Staff table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Icon name="Users" size={36} color="currentColor" />
            <p className="mt-2 text-sm font-medium">
              {search || roleFilter !== 'all' ? 'No staff match your filters' : 'No staff members yet'}
            </p>
            {!search && roleFilter === 'all' && (
              <button onClick={() => setShowModal(true)} className="mt-3 text-sm text-blue-600 hover:underline font-medium">
                Add your first staff member
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    {['Staff Member', 'Role', 'Department', 'Status', 'Joined', 'Actions'].map(h => (
                      <th key={h} className={`px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${h === 'Actions' ? 'text-right' : 'text-left'}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(member => {
                    const active = isActive(member);
                    return (
                      <tr key={member.id} className={`hover:bg-muted/30 transition-colors ${!active ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <Avatar name={member.full_name} />
                            <div>
                              <p className="text-sm font-semibold text-foreground">{member.full_name || 'Unnamed'}</p>
                              <p className="text-xs text-muted-foreground">{member.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleStyle(member.role)}`}>
                            {getRoleLabel(member.role)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-muted-foreground">{member.department || '—'}</td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold
                            ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                            {active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-muted-foreground">
                          {member.created_at ? new Date(member.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setConfirmToggle(member)}
                              title={active ? 'Deactivate' : 'Activate'}
                              className={`p-1.5 rounded-lg transition-colors ${active ? 'hover:bg-red-50' : 'hover:bg-emerald-50'}`}
                            >
                              <Icon name={active ? 'UserX' : 'UserCheck'} size={15} color={active ? '#ef4444' : '#10b981'} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border">
              {filtered.map(member => {
                const active = isActive(member);
                return (
                  <div key={member.id} className={`p-4 ${!active ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <Avatar name={member.full_name} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{member.full_name || 'Unnamed'}</p>
                        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold
                        ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleStyle(member.role)}`}>
                        {getRoleLabel(member.role)}
                      </span>
                      <button
                        onClick={() => setConfirmToggle(member)}
                        className={`text-xs flex items-center gap-1 ${active ? 'text-red-500' : 'text-emerald-600'}`}
                      >
                        <Icon name={active ? 'UserX' : 'UserCheck'} size={13} color="currentColor" />
                        {active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {staff.length} staff members
            </div>
          </>
        )}
      </div>

      {/* Invite modal */}
      {showModal && (
        <InviteModal
          onClose={() => setShowModal(false)}
          onInvite={handleInvite}
          subscription={subscription}
          currentStaffCount={activeCount}
        />
      )}

      {/* Confirm toggle */}
      {confirmToggle && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4
              ${isActive(confirmToggle) ? 'bg-red-100' : 'bg-emerald-100'}`}>
              <Icon
                name={isActive(confirmToggle) ? 'UserX' : 'UserCheck'}
                size={24}
                color={isActive(confirmToggle) ? '#ef4444' : '#10b981'}
              />
            </div>
            <h3 className="text-base font-bold text-foreground text-center mb-1">
              {isActive(confirmToggle) ? 'Deactivate Staff?' : 'Activate Staff?'}
            </h3>
            <p className="text-sm text-muted-foreground text-center mb-5">
              {isActive(confirmToggle)
                ? `${confirmToggle.full_name} will no longer be able to log in.`
                : `${confirmToggle.full_name} will be able to log in again.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleToggle(confirmToggle)}
                className={`flex-1 py-2.5 text-sm font-semibold text-white rounded-xl
                  ${isActive(confirmToggle) ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
              >
                {isActive(confirmToggle) ? 'Deactivate' : 'Activate'}
              </button>
              <button onClick={() => setConfirmToggle(null)}
                className="flex-1 py-2.5 text-sm font-medium border border-border text-muted-foreground rounded-xl hover:bg-muted">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default StaffTab;
