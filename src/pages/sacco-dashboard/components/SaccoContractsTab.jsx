import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import ContractsTab from '../../admin-dashboard/components/ContractsTab';

// Reuses the company ContractsTab UI on the sacco dashboard. Contracts are
// tenant-scoped by admin_id, so the same company_contracts table and
// 'contracts' storage bucket serve a sacco unchanged. The "client" selector is
// fed with sacco MEMBERS — picking one stores company_contracts.member_id,
// which is what the member portal's Contracts tab shows to that member.
const SaccoContractsTab = () => {
  const { user } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [members, setMembers] = useState([]);

  const fetchContracts = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('company_contracts')
      .select('*')
      .eq('admin_id', user.id)
      .order('created_at', { ascending: false });
    setContracts(data || []);
  }, [user?.id]);

  const fetchMembers = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('sacco_members')
      .select('id, full_name, member_no')
      .eq('admin_id', user.id)
      .order('full_name');
    setMembers(data || []);
  }, [user?.id]);

  useEffect(() => { fetchContracts(); fetchMembers(); }, [fetchContracts, fetchMembers]);

  const uploadContract = useCallback(async (formData, file, onProgress) => {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath  = `${user.id}/${Date.now()}_${cleanName}`;

    const { error: upErr } = await supabase.storage.from('contracts').upload(filePath, file, {
      upsert: true, cacheControl: '3600', contentType: file.type || 'application/pdf',
    });
    if (upErr) throw upErr;
    if (onProgress) onProgress(100);

    const { data: { publicUrl } } = supabase.storage.from('contracts').getPublicUrl(filePath);

    const { error } = await supabase.from('company_contracts').insert({
      admin_id: user.id,
      contract_name: formData.name,
      contract_type: formData.type,
      // In the sacco context the selector lists MEMBERS, so the chosen id is a
      // sacco_members.id — stored in member_id (client_id stays null).
      client_id: null,
      member_id: formData.clientId || null,
      file_url: publicUrl,
      is_template: formData.isTemplate || false,
    });
    if (error) throw error;

    await fetchContracts();
  }, [user?.id, fetchContracts]);

  const exportCSV = useCallback((data, filename) => {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const csv  = [
      keys.join(','),
      ...data.map(row =>
        keys.map(k => `"${String(row[k] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // Members masquerade as "clients" for the shared UI (member_no ≈ account no).
  const memberOptions = members.map((m) => ({ id: m.id, full_name: m.full_name, account_number: m.member_no }));

  return <ContractsTab contracts={contracts} clients={memberOptions} onUpload={uploadContract} onExport={exportCSV} />;
};

export default SaccoContractsTab;
