import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { auditLogsService } from '../../../services/supabaseService';

const ROLE_OPTIONS_ALL = [
  { value: 'super_admin',         label: 'Super Administrator', color: 'bg-purple-100 text-purple-700' },
  { value: 'admin',               label: 'Administrator',       color: 'bg-blue-100 text-blue-700' },
  { value: 'director',            label: 'Director',            color: 'bg-indigo-100 text-indigo-700' },
  { value: 'accountant',          label: 'Accountant',          color: 'bg-cyan-100 text-cyan-700' },
  { value: 'collections_officer', label: 'Collections Officer', color: 'bg-orange-100 text-orange-700' },
  { value: 'manager',             label: 'Manager',             color: 'bg-teal-100 text-teal-700' },
  { value: 'finance',             label: 'Finance',             color: 'bg-green-100 text-green-700' },
  { value: 'operations',          label: 'Operations',          color: 'bg-yellow-100 text-yellow-700' },
  { value: 'sales_agent',         label: 'Sales Agent',         color: 'bg-emerald-100 text-emerald-700' },
  { value: 'client',              label: 'Client',              color: 'bg-gray-100 text-gray-700' },
];

const ROLE_OPTIONS_ADMIN = [
  { value: 'director',            label: 'Director',            color: 'bg-indigo-100 text-indigo-700' },
  { value: 'accountant',          label: 'Accountant',          color: 'bg-cyan-100 text-cyan-700' },
  { value: 'collections_officer', label: 'Collections Officer', color: 'bg-orange-100 text-orange-700' },
  { value: 'manager',             label: 'Manager',             color: 'bg-teal-100 text-teal-700' },
  { value: 'finance',             label: 'Finance',             color: 'bg-green-100 text-green-700' },
  { value: 'operations',          label: 'Operations',          color: 'bg-yellow-100 text-yellow-700' },
  { value: 'sales_agent',         label: 'Sales Agent',         color: 'bg-emerald-100 text-emerald-700' },
];

const getRoleStyle = (role) =>
  ROLE_OPTIONS_ALL.find(r => r.value === role)?.color || 'bg-gray-100 text-gray-600';
const getRoleLabel = (role) =>
  ROLE_OPTIONS_ALL.find(r => r.value === role)?.label || role;

const isUserActive = (u) => u.is_active !== false && u.is_active !== null ? true : u.is_active === true;

const Toast = ({ message, type, onClose }) => (
  <div className={`fixed bottom-6 right-6 z-[300] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium
    ${type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
    <Icon name={type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={16} color="white" />
    {message}
    <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">
      <Icon name="X" size={14} color="white" />
    </button>
  </div>
);

const Avatar = ({ name }) => {
  const initials = (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];
  const color = colors[(name || '').charCodeAt(0) % colors.length];
  return (
    <div className={`w-9 h-9 ${color} rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
};

// ── UserModal OUTSIDE UserManagementTab — fixes focus loss on keystroke ───────
const UserModal = ({ user, onClose, onSave, availableRoles = ROLE_OPTIONS_ALL }) => {
  const isEdit = !!user;
  const [form, setForm] = useState({
    full_name:        user?.full_name || '',
    email:            user?.email || '',
    role:             user?.role || availableRoles[0]?.value || 'operations',
    phone:            user?.phone || '',
    department:       user?.department || '',
    password:         '',
    confirm_password: '',
    is_active:        isUserActive(user || {}),
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
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.role) e.role = 'Role is required';
    if (!isEdit) {
      if (!form.password) e.password = 'Password is required';
      else if (form.password.length < 8) e.password = 'Minimum 8 characters';
      if (form.password !== form.confirm_password) e.confirm_password = 'Passwords do not match';
    }
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setLoading(true);
    try {
      if (isEdit) {
        // ── EDIT existing user ───────────────────────────────────────────
        const oldData = {
          full_name:  user.full_name,
          role:       user.role,
          phone:      user.phone,
          department: user.department,
          is_active:  user.is_active,
        };
        const newData = {
          full_name:  form.full_name,
          role:       form.role,
          phone:      form.phone,
          department: form.department,
          is_active:  form.is_active,
        };

        const { error } = await supabase.from('user_profiles').update({
          ...newData,
          updated_at: new Date().toISOString(),
        }).eq('id', user.id);
        if (error) throw error;

        const changes = [];
        if (oldData.full_name  !== newData.full_name)  changes.push(`name: "${oldData.full_name}" → "${newData.full_name}"`);
        if (oldData.role       !== newData.role)       changes.push(`role: ${oldData.role} → ${newData.role}`);
        if (oldData.department !== newData.department) changes.push(`department: ${oldData.department || 'none'} → ${newData.department || 'none'}`);
        if (oldData.is_active  !== newData.is_active)  changes.push(`status: ${oldData.is_active ? 'active' : 'inactive'} → ${newData.is_active ? 'active' : 'inactive'}`);

        try {
          await auditLogsService.log(
            'user_updated', 'user_profiles',
            `Edited user "${form.full_name}" (${user.email})` + (changes.length ? ` — changed: ${changes.join(', ')}` : ''),
            user.id, oldData, newData
          );
        } catch (_) {}

        onSave({ success: true, message: 'User updated successfully' });

      } else {
        // ── CREATE new user via Edge Function ────────────────────────────
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        const adminUserId = sessionData?.session?.user?.id;

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff-user`,
          {
            method: 'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              email:      form.email.trim().toLowerCase(),
              password:   form.password,
              full_name:  form.full_name.trim(),
              role:       form.role,
              phone:      form.phone || '',
              department: form.department || '',
              admin_id:   adminUserId,
            }),
          }
        );

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to create user.');

        try {
          await auditLogsService.log(
            'user_created', 'user_profiles',
            `Created new user "${form.full_name}" (${form.email}) with role: ${form.role}`,
            result.id, null,
            { full_name: form.full_name, email: form.email, role: form.role, department: form.department }
          );
        } catch (_) {}

        onSave({ success: true, message: `User "${form.full_name}" created successfully` });
      }
    } catch (err) {
      onSave({ success: false, message: err.message || 'Something went wrong' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <Icon name={isEdit ? 'UserCog' : 'UserPlus'} size={18} color="white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit User' : 'Add New User'}</h2>
              <p className="text-xs text-gray-500">{isEdit ? `Editing ${user.full_name}` : 'Create a new system user'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <Icon name="X" size={18} color="#6b7280" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* Full Name + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name *</label>
              <input
                type="text"
                value={form.full_name}
                placeholder="e.g. John Doe"
                onChange={e => set('full_name', e.target.value)}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40
                  ${errors.full_name ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
              />
              {errors.full_name && <p className="mt-1 text-xs text-red-500">{errors.full_name}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Email Address *</label>
              <input
                type="email"
                value={form.email}
                placeholder="user@company.com"
                onChange={e => set('email', e.target.value)}
                disabled={isEdit}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40
                  ${errors.email ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}
                  ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Role *</label>
            <select
              value={form.role}
              onChange={e => set('role', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              {availableRoles.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {errors.role && <p className="mt-1 text-xs text-red-500">{errors.role}</p>}
          </div>

          {/* Phone + Department */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                placeholder="+254 7XX XXX XXX"
                onChange={e => set('phone', e.target.value)}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40
                  ${errors.phone ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
              />
              {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Department</label>
              <input
                type="text"
                value={form.department}
                placeholder="e.g. Finance"
                onChange={e => set('department', e.target.value)}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40
                  ${errors.department ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
              />
              {errors.department && <p className="mt-1 text-xs text-red-500">{errors.department}</p>}
            </div>
          </div>

          {/* Password — create only */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Password *</label>
                <input
                  type="password"
                  value={form.password}
                  placeholder="Min 8 characters"
                  onChange={e => set('password', e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40
                    ${errors.password ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
                />
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Confirm Password *</label>
                <input
                  type="password"
                  value={form.confirm_password}
                  placeholder="Repeat password"
                  onChange={e => set('confirm_password', e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40
                    ${errors.confirm_password ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
                />
                {errors.confirm_password && <p className="mt-1 text-xs text-red-500">{errors.confirm_password}</p>}
              </div>
            </div>
          )}

          {/* Active toggle — edit only */}
          {isEdit && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <button
                onClick={() => set('is_active', !form.is_active)}
                className={`relative w-10 h-5 rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                  ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm text-gray-700">
                Account is <strong>{form.is_active ? 'Active' : 'Deactivated'}</strong>
              </span>
            </div>
          )}

          {!isEdit && (
            <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
              The user will receive a confirmation email to verify their account before logging in.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 pt-0">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Saving...
              </>
            ) : (
              <>
                <Icon name={isEdit ? 'Save' : 'UserPlus'} size={15} color="white" />
                {isEdit ? 'Save Changes' : 'Create User'}
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main Tab ──────────────────────────────────────────────────────────────────
const UserManagementTab = () => {
  const { userProfile } = useAuth();
  const [users, setUsers]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [roleFilter, setRoleFilter]       = useState('all');
  const [statusFilter, setStatusFilter]   = useState('all');
  const [modalUser, setModalUser]         = useState(null);
  const [toast, setToast]                 = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);

  // A sacco_admin manages its tenant exactly like a company admin does.
  const isAdmin           = userProfile?.role === 'admin' || userProfile?.role === 'sacco_admin';
  const availableRoles    = isAdmin ? ROLE_OPTIONS_ADMIN : ROLE_OPTIONS_ALL;
  const roleFilterOptions = isAdmin ? ROLE_OPTIONS_ADMIN : ROLE_OPTIONS_ALL;

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const currentRole = userProfile?.role;

      let query;

      if (currentRole === 'super_admin') {
        query = supabase
          .from('user_profiles')
          .select('*')
          .order('created_at', { ascending: false });
      } else if (currentRole === 'admin' || currentRole === 'sacco_admin') {
        query = supabase
          .from('user_profiles')
          .select('*')
          .or(`id.eq.${authUser.id},admin_id.eq.${authUser.id}`)
          .order('created_at', { ascending: false });
      } else {
        query = supabase
          .from('user_profiles')
          .select('*')
          .eq('id', authUser.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      showToast('Failed to load users: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [userProfile]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleSave = ({ success, message }) => {
    setModalUser(null);
    showToast(message, success ? 'success' : 'error');
    if (success) fetchUsers();
  };

  const handleToggleActive = async (user) => {
    try {
      const newStatus = !isUserActive(user);
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_active: newStatus, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw error;

      try {
        await auditLogsService.log(
          newStatus ? 'user_activated' : 'user_deactivated',
          'user_profiles',
          `${newStatus ? 'Activated' : 'Deactivated'} user "${user.full_name}" (${user.email})`,
          user.id,
          { is_active: !newStatus },
          { is_active: newStatus }
        );
      } catch (_) {}

      showToast(`${user.full_name} has been ${newStatus ? 'activated' : 'deactivated'}`);
      fetchUsers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setConfirmToggle(null);
    }
  };

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase());
    const matchRole   = roleFilter === 'all' || u.role === roleFilter;
    const active      = isUserActive(u);
    const matchStatus = statusFilter === 'all' ||
      (statusFilter === 'active' && active) ||
      (statusFilter === 'inactive' && !active);
    return matchSearch && matchRole && matchStatus;
  });

  const isSelf = (u) => u.id === userProfile?.id;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Icon name="Search" size={15} color="#9ca3af" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 bg-white"
          />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none bg-white">
          <option value="all">All Roles</option>
          {roleFilterOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none bg-white">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          onClick={() => setModalUser(false)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
        >
          <Icon name="UserPlus" size={15} color="white" /> Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Users', value: users.length,                               icon: 'Users',     bg: 'bg-blue-50',    ic: '#3b82f6' },
          { label: 'Active',      value: users.filter(u => isUserActive(u)).length,  icon: 'UserCheck', bg: 'bg-emerald-50', ic: '#10b981' },
          { label: 'Inactive',    value: users.filter(u => !isUserActive(u)).length, icon: 'UserX',     bg: 'bg-red-50',     ic: '#ef4444' },
          { label: 'Roles Used',  value: [...new Set(users.map(u => u.role))].length, icon: 'Shield',   bg: 'bg-purple-50',  ic: '#8b5cf6' },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-3 shadow-sm">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.bg}`}>
              <Icon name={s.icon} size={16} color={s.ic} />
            </div>
            <div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold text-gray-900">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Admin scope notice */}
      {isAdmin && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs">
          <Icon name="Info" size={14} color="currentColor" />
          You can only see and manage users within your company.
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
            Loading users...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Icon name="Users" size={36} color="currentColor" />
            <p className="mt-2 text-sm">{search || roleFilter !== 'all' ? 'No users match your filters' : 'No users yet'}</p>
            {!search && roleFilter === 'all' && (
              <button onClick={() => setModalUser(false)} className="mt-3 text-sm text-blue-600 hover:underline">
                Add your first user
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['User', 'Role', 'Department', 'Status', 'Joined', 'Actions'].map(h => (
                      <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide
                        ${h === 'Actions' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(u => {
                    const active = isUserActive(u);
                    return (
                      <tr key={u.id} className={`hover:bg-gray-50/70 transition-colors ${!active ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <Avatar name={u.full_name} />
                            <div>
                              <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                                {u.full_name || 'Unnamed'}
                                {isSelf(u) && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full">You</span>}
                              </p>
                              <p className="text-xs text-gray-500">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleStyle(u.role)}`}>
                            {getRoleLabel(u.role)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-gray-500">{u.department || '—'}</td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold
                            ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                            {active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-500">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setModalUser(u)} title="Edit user"
                              className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors">
                              <Icon name="Edit2" size={15} color="#3b82f6" />
                            </button>
                            {!isSelf(u) && (
                              <button onClick={() => setConfirmToggle(u)}
                                title={active ? 'Deactivate' : 'Activate'}
                                className={`p-1.5 rounded-lg transition-colors ${active ? 'hover:bg-red-50' : 'hover:bg-emerald-50'}`}>
                                <Icon name={active ? 'UserX' : 'UserCheck'} size={15} color={active ? '#ef4444' : '#10b981'} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-gray-50">
              {filtered.map(u => {
                const active = isUserActive(u);
                return (
                  <div key={u.id} className={`p-4 ${!active ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar name={u.full_name} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                          {u.full_name || 'Unnamed'}
                          {isSelf(u) && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full">You</span>}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{u.email}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold
                        ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleStyle(u.role)}`}>
                        {getRoleLabel(u.role)}
                      </span>
                      <div className="flex gap-3">
                        <button onClick={() => setModalUser(u)} className="text-xs text-blue-600 flex items-center gap-1">
                          <Icon name="Edit2" size={13} color="#3b82f6" /> Edit
                        </button>
                        {!isSelf(u) && (
                          <button onClick={() => setConfirmToggle(u)}
                            className={`text-xs flex items-center gap-1 ${active ? 'text-red-500' : 'text-emerald-600'}`}>
                            <Icon name={active ? 'UserX' : 'UserCheck'} size={13} color="currentColor" />
                            {active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!loading && filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-50 text-xs text-gray-400">
            Showing {filtered.length} of {users.length} users
          </div>
        )}
      </div>

      {/* User Modal */}
      {modalUser !== null && (
        <UserModal
          key={modalUser ? modalUser.id : 'new'}
          user={modalUser || null}
          onClose={() => setModalUser(null)}
          onSave={handleSave}
          availableRoles={availableRoles}
        />
      )}

      {/* Confirm toggle */}
      {confirmToggle && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4
              ${isUserActive(confirmToggle) ? 'bg-red-100' : 'bg-emerald-100'}`}>
              <Icon
                name={isUserActive(confirmToggle) ? 'UserX' : 'UserCheck'}
                size={24}
                color={isUserActive(confirmToggle) ? '#ef4444' : '#10b981'}
              />
            </div>
            <h3 className="text-base font-bold text-gray-900 text-center mb-1">
              {isUserActive(confirmToggle) ? 'Deactivate User?' : 'Activate User?'}
            </h3>
            <p className="text-sm text-gray-500 text-center mb-5">
              {isUserActive(confirmToggle)
                ? `${confirmToggle.full_name} will no longer be able to log in.`
                : `${confirmToggle.full_name} will be able to log in again.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleToggleActive(confirmToggle)}
                className={`flex-1 py-2.5 text-sm font-semibold text-white rounded-xl
                  ${isUserActive(confirmToggle) ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
              >
                {isUserActive(confirmToggle) ? 'Yes, Deactivate' : 'Yes, Activate'}
              </button>
              <button onClick={() => setConfirmToggle(null)}
                className="flex-1 py-2.5 text-sm font-medium border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50">
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

export default UserManagementTab;
