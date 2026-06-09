import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import AssetRegistrationForm from './components/AssetRegistrationForm';
import ClientRegistrationForm from './components/ClientRegistrationForm';
import AssetCard from './components/AssetCard';
import ClientCard from './components/ClientCard';
import LinkAssetClientModal from './components/LinkAssetClientModal';
import AssetDetailsModal from './components/AssetDetailsModal';
import ClientDetailsModal from './components/ClientDetailsModal';
import MainLayout from '../../layouts/MainLayout';
import { auditLogsService } from '../../services/supabaseService';
import { supabase } from '../../lib/supabase';

let _acmChannelSeq = 0;

const SpinnerIcon = ({ size = 14 }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);

const AssetClientManagement = () => {
  const [activeTab, setActiveTab] = useState('assets');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showAssetDetails, setShowAssetDetails] = useState(false);
  const [showClientDetails, setShowClientDetails] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [editingClient, setEditingClient] = useState(null);
  const [linkingData, setLinkingData] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [assets, setAssets] = useState([]);
  const [clients, setClients] = useState([]);
  const [adminId, setAdminId] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [syncError, setSyncError] = useState(false);
  const [portalCredentials, setPortalCredentials] = useState(null);

  // ── Get current admin ID and company profile ───────────────────────────────
  useEffect(() => {
    const fetchAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setAdminId(user.id);
        const { data: profile } = await supabase
          .from('company_profiles')
          .select('*')
          .eq('admin_id', user.id)
          .single();
        setCompanyProfile(profile);
      }
    };
    fetchAdmin();
  }, []);

  // ── Load assets filtered by admin ─────────────────────────────────────────
  const loadAssets = useCallback(async (isRealtime = false) => {
    if (!adminId) return;
    if (isRealtime) setSyncing(true);
    setSyncError(false);
    try {
      const { data, error: err } = await supabase
        .from('assets')
        .select('*, linked_client:clients(full_name, account_number)')
        .eq('registered_by', adminId)
        .order('created_at', { ascending: false });

      if (err) throw err;

      setAssets((data || []).map(a => ({
        id: a.asset_code,
        _id: a.id,
        type: a.asset_type,
        description: a.description,
        sellingPrice: parseFloat(a.selling_price || 0),
        status: a.asset_status,
        location: a.location,
        specifications: a.specifications || '',
        metadata: a.metadata || {},
        propertyDetails: a.asset_type === 'property'
          ? { type: a.property_type, size: a.property_size, location: a.location }
          : null,
        vehicleDetails: a.asset_type === 'vehicle'
          ? { make: a.make, model: a.model, year: a.year, color: a.color, plate: a.plate_number, chassis: a.chassis_number }
          : null,
        images: a.images || [],
        linkedClient: a.linked_client
          ? `${a.linked_client.full_name} (${a.linked_client.account_number})`
          : null,
      })));
      setLastSynced(new Date());
      setConnectionStatus('connected');
    } catch (err) {
      setError('Failed to load assets');
      setSyncError(true);
      setConnectionStatus('disconnected');
    } finally {
      if (isRealtime) setSyncing(false);
    }
  }, [adminId]);

  // ── Load clients filtered by admin ────────────────────────────────────────
  const loadClients = useCallback(async (isRealtime = false) => {
    if (!adminId) return;
    if (isRealtime) setSyncing(true);
    try {
      const { data, error: err } = await supabase
        .from('clients')
        .select('*')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false });

      if (err) throw err;

      setClients((data || []).map(c => ({
        // Card display fields
        id: c.account_number,
        _id: c.id,
        name: c.full_name,
        fullName: c.full_name,
        accountNumber: c.account_number,
        email: c.email,
        phone: c.phone,
        nationalId: c.national_id,
        address: c.address,
        city: c.city,
        status: c.client_status,
        creditScore: c.credit_score,
        totalAssets: c.total_assets,
        outstandingBalance: parseFloat(c.outstanding_balance || 0),
        notes: c.notes,
        kycStatus: c.kyc_status,
        // All fields needed by the edit form
        account_number:     c.account_number,
        full_name:          c.full_name,
        client_type:        c.client_type        || 'individual',
        national_id:        c.national_id,
        passport_number:    c.passport_number,
        kra_pin:            c.kra_pin,
        alternate_phone:    c.alternate_phone,
        date_of_birth:      c.date_of_birth,
        occupation:         c.occupation,
        employer_name:      c.employer_name,
        employer_address:   c.employer_address,
        employer_phone:     c.employer_phone,
        monthly_income:     c.monthly_income,
        physical_address:   c.physical_address,
        postal_address:     c.postal_address,
        country:            c.country,
        photo_url:          c.photo_url,
        photoUrl:           c.photo_url,
        nok_name:           c.nok_name,
        nok_phone:          c.nok_phone,
        nok_relationship:   c.nok_relationship,
        company_name:       c.company_name,
        company_reg_number: c.company_reg_number,
        directors:          c.directors,
        client_status:      c.client_status,
        kyc_status:         c.kyc_status,
      })));
      setLastSynced(new Date());
      setConnectionStatus('connected');
    } catch (err) {
      setError('Failed to load clients');
      setSyncError(true);
      setConnectionStatus('disconnected');
    } finally {
      if (isRealtime) setSyncing(false);
    }
  }, [adminId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadAssets(), loadClients()]);
    setLoading(false);
  }, [loadAssets, loadClients]);

  useEffect(() => {
    if (adminId) {
      loadData();

      const assetsSub = supabase
        .channel(`acm_assets_${++_acmChannelSeq}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, () => loadAssets(true))
        .subscribe(status => {
          if (status === 'SUBSCRIBED') setConnectionStatus('connected');
          if (status === 'CHANNEL_ERROR') setConnectionStatus('disconnected');
        });

      const clientsSub = supabase
        .channel(`acm_clients_${_acmChannelSeq}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => loadClients(true))
        .subscribe();

      return () => {
        supabase.removeChannel(assetsSub);
        supabase.removeChannel(clientsSub);
      };
    }
  }, [adminId, loadData, loadAssets, loadClients]);

  // ── Save asset with admin_id ───────────────────────────────────────────────
  const handleSaveAsset = async (assetData) => {
    setSyncing(true);
    try {
      if (editingAsset?._id) {
        await supabase
          .from('assets')
          .update({
            description: assetData.description,
            asset_type: assetData.type,
            selling_price: assetData.sellingPrice,
            current_value: assetData.sellingPrice,
            asset_status: assetData.status,
            location: assetData.location || assetData.propertyLocation || assetData.heavyLocation || '',
            make: assetData.make,
            model: assetData.model,
            year: assetData.year,
            color: assetData.color,
            plate_number: assetData.plateNumber,
            chassis_number: assetData.chassisNumber,
            property_type: assetData.propertyType,
            property_size: assetData.propertySize,
            images: assetData.images || [],
            metadata: {
              propertyTitle: assetData.propertyTitle,
              propertyBedsath: assetData.propertyBedsath,
              propertyLandRef: assetData.propertyLandRef,
              engineCC: assetData.engineCC,
              fuelType: assetData.fuelType,
              mileage: assetData.mileage,
              gearbox: assetData.gearbox,
              constCategory: assetData.constCategory,
              constBrand: assetData.constBrand,
              constUnit: assetData.constUnit,
              constQty: assetData.constQty,
              constGrade: assetData.constGrade,
              constWarehouse: assetData.constWarehouse,
              elecBrand: assetData.elecBrand,
              elecModel: assetData.elecModel,
              elecSerial: assetData.elecSerial,
              elecCondition: assetData.elecCondition,
              elecWarranty: assetData.elecWarranty,
              furnCategory: assetData.furnCategory,
              furnMaterial: assetData.furnMaterial,
              furnBrand: assetData.furnBrand,
              furnColor: assetData.furnColor,
              furnDimension: assetData.furnDimension,
              furnCondition: assetData.furnCondition,
              heavyBrand: assetData.heavyBrand,
              heavyModel: assetData.heavyModel,
              heavySerial: assetData.heavySerial,
              heavyYear: assetData.heavyYear,
              heavyHours: assetData.heavyHours,
              heavyLocation: assetData.heavyLocation,
            },
            specifications: assetData.specifications,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingAsset._id);
        await auditLogsService?.log('update', 'assets', `Updated asset ${assetData.description}`);
      } else {
        await supabase
          .from('assets')
          .insert({
            asset_code: `AST-${Date.now()}`,
            asset_type: assetData.type || 'other',
            description: assetData.description,
            selling_price: assetData.sellingPrice || 0,
            current_value: assetData.sellingPrice || 0,
            asset_status: assetData.status || 'available',
            location: assetData.location || assetData.propertyLocation || assetData.heavyLocation || '',
            make: assetData.make,
            model: assetData.model,
            year: assetData.year,
            color: assetData.color,
            plate_number: assetData.plateNumber,
            chassis_number: assetData.chassisNumber,
            property_type: assetData.propertyType,
            property_size: assetData.propertySize,
            images: assetData.images || [],
            metadata: {
              propertyTitle: assetData.propertyTitle,
              propertyBedsath: assetData.propertyBedsath,
              propertyLandRef: assetData.propertyLandRef,
              engineCC: assetData.engineCC,
              fuelType: assetData.fuelType,
              mileage: assetData.mileage,
              gearbox: assetData.gearbox,
              constCategory: assetData.constCategory,
              constBrand: assetData.constBrand,
              constUnit: assetData.constUnit,
              constQty: assetData.constQty,
              constGrade: assetData.constGrade,
              constWarehouse: assetData.constWarehouse,
              elecBrand: assetData.elecBrand,
              elecModel: assetData.elecModel,
              elecSerial: assetData.elecSerial,
              elecCondition: assetData.elecCondition,
              elecWarranty: assetData.elecWarranty,
              furnCategory: assetData.furnCategory,
              furnMaterial: assetData.furnMaterial,
              furnBrand: assetData.furnBrand,
              furnColor: assetData.furnColor,
              furnDimension: assetData.furnDimension,
              furnCondition: assetData.furnCondition,
              heavyBrand: assetData.heavyBrand,
              heavyModel: assetData.heavyModel,
              heavySerial: assetData.heavySerial,
              heavyYear: assetData.heavyYear,
              heavyHours: assetData.heavyHours,
              heavyLocation: assetData.heavyLocation,
            },
            specifications: assetData.specifications,
            registered_by: adminId,
          });
        await auditLogsService?.log('create', 'assets', `Registered new asset ${assetData.description}`);
      }
      setShowAssetForm(false);
      setEditingAsset(null);
      await loadAssets();
    } catch (err) {
      setError('Failed to save asset: ' + err?.message);
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  };

  // ── Save client with admin_id ──────────────────────────────────────────────
  // ── Provision client portal login WITHOUT email (no rate limit) ───────────
  // Creates the auth account directly with a temporary password via the
  // create-staff-user Edge Function (admin.createUser, email auto-confirmed) so
  // there's no dependency on Supabase's email rate limit. Returns the generated
  // password so the admin can share it with the client.
  const provisionClientAccount = async ({ email, fullName, phone }) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('No active session — cannot create login.');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        ? import.meta.env.VITE_SUPABASE_URL.startsWith('http')
          ? import.meta.env.VITE_SUPABASE_URL
          : `https://${import.meta.env.VITE_SUPABASE_URL}.supabase.co`
        : '';
      const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // Strong temporary password: >= 8 chars, one of each class, no ambiguous chars.
      const pick = (s) => s[Math.floor(Math.random() * s.length)];
      const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789', SY = '@#$%';
      let password = pick(U) + pick(L) + pick(D) + pick(SY);
      for (let i = 0; i < 8; i++) password += pick(U + L + D + SY);

      const res = await fetch(`${supabaseUrl}/functions/v1/create-staff-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': supabaseAnon,
        },
        body: JSON.stringify({
          email, password, full_name: fullName, role: 'client',
          phone: phone || '', admin_id: adminId,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || 'Login creation failed');
      return { success: true, password };
    } catch (err) {
      // Non-fatal: the client record was saved; just surface a warning.
      return { success: false, error: err?.message };
    }
  };

  // ── Email the login credentials to the client (via Resend, no rate limit) ──
  const sendCredentialsEmail = async ({ email, fullName, password, accountNumber }) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        ? import.meta.env.VITE_SUPABASE_URL.startsWith('http')
          ? import.meta.env.VITE_SUPABASE_URL
          : `https://${import.meta.env.VITE_SUPABASE_URL}.supabase.co`
        : '';
      const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': supabaseAnon,
        },
        body: JSON.stringify({
          type: 'client_welcome',
          to: email,
          data: { fullName, email, password, accountNumber, portalUrl: `${window.location.origin}/login` },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Email failed');
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message };
    }
  };

  const handleSaveClient = async (clientData) => {
    setSyncing(true);
    try {
      // clientData comes directly from ClientRegistrationForm payload
      // field names match the DB columns exactly (full_name, national_id etc.)
      const name = clientData.full_name || clientData.fullName || '';

      if (editingClient?._id) {
        const updatePayload = {
          full_name:        clientData.full_name        || clientData.fullName,
          email:            clientData.email,
          phone:            clientData.phone,
          national_id:      clientData.national_id      || clientData.nationalId      || null,
          passport_number:  clientData.passport_number  || null,
          kra_pin:          clientData.kra_pin          || null,
          alternate_phone:  clientData.alternate_phone  || null,
          date_of_birth:    clientData.date_of_birth    || null,
          occupation:       clientData.occupation       || null,
          employer_name:    clientData.employer_name    || null,
          monthly_income:   clientData.monthly_income   || null,
          physical_address: clientData.physical_address || clientData.address || null,
          postal_address:   clientData.postal_address   || null,
          city:             clientData.city             || null,
          country:          clientData.country          || 'Kenya',
          nok_name:         clientData.nok_name         || null,
          nok_phone:        clientData.nok_phone        || null,
          nok_relationship: clientData.nok_relationship || null,
          client_status:    clientData.client_status    || clientData.status || 'active',
          kyc_status:       clientData.kyc_status       || 'incomplete',
          photo_url:        clientData.photo_url        || null,
        };
        Object.keys(updatePayload).forEach(k => updatePayload[k] === undefined && delete updatePayload[k]);
        const { error: updateErr } = await supabase.from('clients').update(updatePayload).eq('id', editingClient._id);
        if (updateErr) throw updateErr;
        await auditLogsService?.log('update', 'clients', `Updated client ${name}`);
      } else {
        const insertPayload = {
          account_number:   clientData.account_number || `ACC-${Date.now()}`,
          full_name:        clientData.full_name        || clientData.fullName,
          email:            clientData.email,
          phone:            clientData.phone,
          national_id:      clientData.national_id      || clientData.nationalId      || null,
          passport_number:  clientData.passport_number  || null,
          kra_pin:          clientData.kra_pin          || null,
          alternate_phone:  clientData.alternate_phone  || null,
          date_of_birth:    clientData.date_of_birth    || null,
          occupation:       clientData.occupation       || null,
          employer_name:    clientData.employer_name    || null,
          monthly_income:   clientData.monthly_income   || null,
          physical_address: clientData.physical_address || clientData.address || null,
          postal_address:   clientData.postal_address   || null,
          city:             clientData.city             || null,
          country:          clientData.country          || 'Kenya',
          nok_name:         clientData.nok_name         || null,
          nok_phone:        clientData.nok_phone        || null,
          nok_relationship: clientData.nok_relationship || null,
          client_status:    clientData.client_status    || 'pending',
          kyc_status:       clientData.kyc_status       || 'incomplete',
          admin_id:         adminId,
          created_by:       adminId,
          company_name:     clientData.company_name     || null,
          company_reg_number: clientData.company_reg_number || null,
          client_type:      clientData.client_type      || null,
          directors:        clientData.directors        || null,
          photo_url:        clientData.photo_url        || null,
        };
        // Strip keys that may not exist as columns to avoid 400 errors
        const safeKeys = ['account_number','full_name','email','phone','national_id','passport_number','kra_pin','alternate_phone','date_of_birth','occupation','employer_name','monthly_income','physical_address','postal_address','city','country','nok_name','nok_phone','nok_relationship','client_status','kyc_status','admin_id','created_by','company_name','company_reg_number','client_type','directors','photo_url'];
        const safePayload = Object.fromEntries(Object.entries(insertPayload).filter(([k]) => safeKeys.includes(k) && insertPayload[k] !== undefined));
        // Insert client record and retrieve the new row's id
        const { data: insertedClient, error: insertErr } = await supabase
          .from('clients')
          .insert(safePayload)
          .select('id, account_number')
          .single();
        if (insertErr) throw insertErr;
        await auditLogsService?.log('create', 'clients', `Created new client ${name}`);

        // ── Auto-provision client portal login account ────────────────────
        if (clientData.email && insertedClient?.id) {
          const provisionResult = await provisionClientAccount({
            clientId:      insertedClient.id,
            email:         clientData.email,
            fullName:      name,
            phone:         clientData.phone || null,
            accountNumber: insertedClient.account_number || safePayload.account_number,
          });

          if (provisionResult.success) {
            // Email the credentials to the client automatically, and also show
            // them to the admin as a fallback in case email delivery fails.
            setError('');
            const creds = {
              fullName:      name,
              email:         clientData.email,
              password:      provisionResult.password,
              accountNumber: insertedClient.account_number || safePayload.account_number,
            };
            setPortalCredentials({ ...creds, emailStatus: 'sending' });
            const emailRes = await sendCredentialsEmail(creds);
            setPortalCredentials({
              ...creds,
              emailStatus: emailRes.success ? 'sent' : 'failed',
              emailError:  emailRes.error,
            });
          } else {
            // Client record saved successfully — login can be retried later.
            console.warn('[AssetFlow] Portal provisioning warning:', provisionResult.error);
            setError(
              `Client saved, but the portal login could not be created: ${provisionResult.error}.`
            );
          }
        }
      }
      setShowClientForm(false);
      setEditingClient(null);
      await loadClients();
    } catch (err) {
      setError('Failed to save client: ' + err?.message);
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteAsset = async (asset) => {
    setSyncing(true);
    try {
      await supabase.from('assets').delete().eq('id', asset._id);
      await auditLogsService?.log('delete', 'assets', `Deleted asset ${asset.description}`);
      await loadAssets();
    } catch (err) {
      setError('Failed to delete asset: ' + err?.message);
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteClient = async (client) => {
    setSyncing(true);
    try {
      await supabase.from('clients').delete().eq('id', client._id);
      await auditLogsService?.log('delete', 'clients', `Deleted client ${client.name}`);
      await loadClients();
    } catch (err) {
      setError('Failed to delete client: ' + err?.message);
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  };

  const filteredAssets = assets.filter(asset => {
    const matchesSearch = !searchQuery ||
      asset.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.id?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || asset.type === filterType;
    const matchesStatus = filterStatus === 'all' || asset.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const filteredClients = clients.filter(client => {
    const matchesSearch = !searchQuery ||
      client.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.id?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || client.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // ── Asset types based on company profile ──────────────────────────────────
  const allowedTypes = companyProfile?.asset_types || [];
  const typeMap = {
    'Vehicles': 'vehicle',
    'Property/Land': 'property',
    'Construction Dealers': 'construction_dealers',
    'Electronics': 'electronics',
    'Furnitures': 'furnitures',
    'Heavy Equipment': 'heavy_equipment',
  };

  const assetTypeOptions = [
    { value: 'all', label: 'All Types' },
    ...(allowedTypes.length > 0
      ? allowedTypes.map(t => ({ value: typeMap[t] || t.toLowerCase(), label: t }))
      : [
          { value: 'property', label: 'Property' },
          { value: 'vehicle', label: 'Vehicle' },
          { value: 'equipment', label: 'Equipment' },
        ]
    ),
  ];

  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'available', label: 'Available' },
    { value: 'reserved', label: 'Reserved' },
    { value: 'sold', label: 'Sold' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
  ];

  const connectionConfig = {
    connected: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Connected' },
    connecting: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', dot: 'bg-amber-500', text: 'text-amber-600', label: 'Connecting...' },
    disconnected: { bg: 'bg-red-500/10', border: 'border-red-500/20', dot: 'bg-red-500', text: 'text-red-600', label: 'Disconnected' },
  };
  const conn = connectionConfig[connectionStatus];

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Assets & Clients</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {companyProfile?.company_name
                ? `${companyProfile.company_name} · Your assets and clients only`
                : 'Manage your assets and client portfolio'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${conn?.bg} border ${conn?.border}`}>
              <span className={`w-2 h-2 rounded-full ${conn?.dot} ${connectionStatus === 'connecting' ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-medium ${conn?.text}`}>{conn?.label}</span>
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all ${
              syncError ? 'bg-red-500/10 border-red-500/20 text-red-600' :
              syncing ? 'bg-blue-500/10 border-blue-500/20 text-blue-600' :
              'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
            }`}>
              {syncing ? (
                <><SpinnerIcon /><span className="text-xs font-medium">Syncing...</span></>
              ) : syncError ? (
                <><Icon name="AlertCircle" size={12} color="currentColor" /><span className="text-xs font-medium">Sync Error</span></>
              ) : (
                <><Icon name="CheckCircle" size={12} color="currentColor" /><span className="text-xs font-medium">Synced{lastSynced ? ` · ${lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span></>
              )}
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => activeTab === 'assets' ? setShowAssetForm(true) : setShowClientForm(true)}
            >
              <Icon name="Plus" size={16} color="white" />
              {activeTab === 'assets' ? 'Add Asset' : 'Add Client'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            <Icon name="AlertCircle" size={16} color="currentColor" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <Icon name="X" size={14} color="currentColor" />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit">
          {['assets', 'clients'].map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSearchQuery(''); setFilterType('all'); setFilterStatus('all'); }}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-smooth capitalize ${
                activeTab === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'assets' ? `Assets (${assets.length})` : `Clients (${clients.length})`}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input
              placeholder={`Search ${activeTab}...`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              prefix={<Icon name="Search" size={14} color="currentColor" />}
            />
          </div>
          {activeTab === 'assets' && (
            <Select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              options={assetTypeOptions}
              className="w-40"
            />
          )}
          <Select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            options={statusOptions}
            className="w-36"
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : activeTab === 'assets' ? (
          filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Icon name="Package" size={48} color="currentColor" />
              <p className="mt-3 text-base font-semibold text-foreground">No assets found</p>
              <p className="text-sm mt-1">Add your first asset to get started</p>
              {companyProfile?.asset_types?.length > 0 && (
                <p className="text-xs mt-2 text-muted-foreground">
                  Allowed types: {companyProfile.asset_types.join(', ')}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAssets.map(asset => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onEdit={a => { setEditingAsset(a); setShowAssetForm(true); }}
                  onDelete={handleDeleteAsset}
                  onLink={a => { setLinkingData({ asset: a, clients }); setShowLinkModal(true); }}
                  onView={a => { setSelectedAsset(a); setShowAssetDetails(true); }}
                />
              ))}
            </div>
          )
        ) : (
          filteredClients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Icon name="Users" size={48} color="currentColor" />
              <p className="mt-3 text-base font-semibold text-foreground">No clients found</p>
              <p className="text-sm mt-1">Add your first client to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredClients.map(client => (
                <ClientCard
                  key={client.id}
                  client={client}
                  onEdit={c => { setEditingClient(c); setShowClientForm(true); }}
                  onDelete={handleDeleteClient}
                  onView={c => { setSelectedClient(c); setShowClientDetails(true); }}
                  onLink={c => { setLinkingData({ client: c, assets }); setShowLinkModal(true); }}
                />
              ))}
            </div>
          )
        )}

        {/* Modals */}
        {showAssetForm && (
          <AssetRegistrationForm
            asset={editingAsset}
            onSubmit={handleSaveAsset}
            onClose={() => { setShowAssetForm(false); setEditingAsset(null); }}
            allowedAssetTypes={assetTypeOptions.filter(t => t.value !== 'all')}
          />
        )}
        {showClientForm && (
          <ClientRegistrationForm
            editData={editingClient}
            onSubmit={handleSaveClient}
            onClose={() => { setShowClientForm(false); setEditingClient(null); }}
          />
        )}
        {showLinkModal && linkingData && (
          <LinkAssetClientModal
            type={linkingData.asset ? 'asset' : 'client'}
            data={linkingData}
            clients={linkingData.asset ? clients : undefined}
            assets={linkingData.client ? assets : undefined}
            onSubmit={async (assetId, clientId) => {
              const asset = assets.find(a => a.id === assetId);
              if (asset?._id) {
                await supabase
                  .from('assets')
                  .update({ linked_client_id: clientId })
                  .eq('id', asset._id);
              }
              setShowLinkModal(false);
              await loadAssets();
            }}
            onClose={() => setShowLinkModal(false)}
          />
        )}
        {showAssetDetails && selectedAsset && (
          <AssetDetailsModal asset={selectedAsset} onClose={() => setShowAssetDetails(false)} />
        )}
        {showClientDetails && selectedClient && (
          <ClientDetailsModal client={selectedClient} onClose={() => setShowClientDetails(false)} />
        )}

        {/* Client portal login created — show credentials to share */}
        {portalCredentials && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="bg-emerald-600 px-6 py-5 text-center">
                <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">Client Portal Login Created</h2>
                <p className="text-xs text-emerald-100 mt-1">
                  {portalCredentials.emailStatus === 'sent'
                    ? `Login details emailed to ${portalCredentials.email}`
                    : 'Share these credentials with the client'}
                </p>
              </div>

              <div className="px-6 py-5 space-y-3">
                {portalCredentials.emailStatus === 'sending' && (
                  <div className="rounded-lg px-3 py-2 text-xs bg-blue-50 border border-blue-200 text-blue-700">
                    Sending login details to the client by email…
                  </div>
                )}
                {portalCredentials.emailStatus === 'sent' && (
                  <div className="rounded-lg px-3 py-2 text-xs bg-emerald-50 border border-emerald-200 text-emerald-700">
                    ✅ Login details were emailed to {portalCredentials.email}.
                  </div>
                )}
                {portalCredentials.emailStatus === 'failed' && (
                  <div className="rounded-lg px-3 py-2 text-xs bg-amber-50 border border-amber-200 text-amber-800">
                    ⚠️ Couldn't email the client automatically{portalCredentials.emailError ? ` (${portalCredentials.emailError})` : ''}. Share the details below manually.
                  </div>
                )}
                {[
                  { label: 'Name',          value: portalCredentials.fullName },
                  { label: 'Login Email',   value: portalCredentials.email },
                  { label: 'Temp Password', value: portalCredentials.password, mono: true },
                  { label: 'Account No.',   value: portalCredentials.accountNumber },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} className="flex items-center justify-between gap-3 bg-muted/40 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.label}</p>
                      <p className={`text-sm font-semibold text-foreground truncate ${r.mono ? 'font-mono' : ''}`}>{r.value}</p>
                    </div>
                    <button
                      onClick={() => navigator.clipboard?.writeText(String(r.value))}
                      className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted flex-shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                ))}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  ⚠️ This password is shown only once and cannot be retrieved later. The client signs in at the portal and can change it.
                </div>
              </div>

              <div className="px-6 pb-5 flex gap-3">
                <button
                  onClick={() => navigator.clipboard?.writeText(
                    `AssetFlow Client Portal Login\nName: ${portalCredentials.fullName}\nEmail: ${portalCredentials.email}\nPassword: ${portalCredentials.password}\nAccount: ${portalCredentials.accountNumber || ''}`
                  )}
                  className="px-4 py-2.5 border border-border text-muted-foreground text-sm font-medium rounded-xl hover:bg-muted"
                >
                  Copy all
                </button>
                <button
                  onClick={() => setPortalCredentials(null)}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default AssetClientManagement;
