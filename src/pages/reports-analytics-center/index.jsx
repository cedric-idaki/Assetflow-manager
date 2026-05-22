import React, { useState, useEffect, useCallback } from 'react';
import MainLayout from '../../layouts/MainLayout';
import { supabase } from '../../lib/supabase';
import ReportsHub from '../admin-dashboard/components/ReportsHub';

const ReportsAnalyticsCenter = () => {
  const [adminId,        setAdminId]        = useState(null);
  const [assets,         setAssets]         = useState([]);
  const [payments,       setPayments]       = useState([]);
  const [agents,         setAgents]         = useState([]);
  const [clients,        setClients]        = useState([]);
  const [employees,      setEmployees]      = useState([]);
  const [payrollRecords, setPayrollRecords] = useState([]);
  const [loading,        setLoading]        = useState(true);

  const resolveAdminId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('user_profiles').select('id, role, admin_id').eq('id', user.id).single();
    return profile?.role === 'admin' ? user.id : (profile?.admin_id || user.id);
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const aId = await resolveAdminId();
        setAdminId(aId);
        if (!aId) return;

        const [assetsRes, paymentsRes, agentsRes, clientsRes, employeesRes, payrollRes] = await Promise.all([
          supabase.from('assets').select('*').eq('company_id', aId).order('created_at', { ascending: false }),
          supabase.from('payments').select('*').order('payment_date', { ascending: false }).limit(500),
          supabase.from('user_profiles').select('*').eq('admin_id', aId).eq('role', 'sales_agent'),
          supabase.from('clients').select('*').eq('admin_id', aId).order('created_at', { ascending: false }),
          // HR employees — all staff under this admin excluding clients and super_admin
          supabase.from('user_profiles')
            .select('id, full_name, email, role, department, employment_type, is_active, basic_salary, housing_allowance, transport_allowance, date_joined, kra_pin, nssf_number, national_id')
            .eq('admin_id', aId)
            .not('role', 'in', '("client","super_admin","sales_agent")'),
          // Payroll records for this admin
          supabase.from('payroll_records')
            .select('*')
            .eq('admin_id', aId)
            .order('pay_month', { ascending: false })
            .limit(500),
        ]);

        setAssets(assetsRes.data         || []);
        setPayments(paymentsRes.data     || []);
        setAgents(agentsRes.data         || []);
        setClients(clientsRes.data       || []);
        setEmployees(employeesRes.data   || []);
        setPayrollRecords(payrollRes.data || []);
      } catch (err) {
        console.error('Reports load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [resolveAdminId]);

  return (
    <MainLayout>
      <div className="p-5">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <ReportsHub
            assets={assets}
            payments={payments}
            agents={agents}
            clients={clients}
            employees={employees}
            payrollRecords={payrollRecords}
          />
        )}
      </div>
    </MainLayout>
  );
};

export default ReportsAnalyticsCenter;
