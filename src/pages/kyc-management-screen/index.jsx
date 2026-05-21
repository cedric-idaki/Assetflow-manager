import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';

import MainLayout from '../../layouts/MainLayout';
import { auditLogsService } from '../../services/supabaseService';
import { supabase } from '../../lib/supabase';

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
        id: c.account_number,
        _id: c.id,
        name: c.full_name,
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
        .channel('acm_assets')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, () => loadAssets(true))
        .subscribe(status => {
          if (status === 'SUBSCRIBED') setConnectionStatus('connected');
          if (status === 'CHANNEL_ERROR') setConnectionStatus('disconnected');
        });

      const clientsSub = supabase
        .channel('acm_clients')
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
  const handleSaveClient = async (clientData) => {
    setSyncing(true);
    try {
      // clientData comes directly from ClientRegistrationForm payload
      // field names match the DB columns exactly (full_name, national_id etc.)
      const name = clientData.full_name || clientData.fullName || '';

      if (editingClient?._id) {
        // Only update columns confirmed to exist in the clients table
        const updatePayload = {
          full_name:     clientData.full_name     || clientData.fullName,
          email:         clientData.email,
          phone:         clientData.phone,
          national_id:   clientData.national_id   || clientData.nationalId || null,
          city:          clientData.city          || null,
          country:       clientData.country       || 'Kenya',
          client_status: clientData.client_status || clientData.status || 'active',
          kyc_status:    clientData.kyc_status    || 'incomplete',
        };
        // Add address/notes only if they exist in your DB
        if (clientData.address)  updatePayload.address = clientData.address;
        if (clientData.notes)    updatePayload.notes   = clientData.notes;
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
        };
        // Only use columns confirmed to exist in the clients table
        // physical_address, kra_pin, passport_number, alternate_phone, date_of_birth,
        // occupation, employer_name, monthly_income, postal_address, nok_* do NOT exist
        const corePayload = {
          account_number: insertPayload.account_number,
          full_name:      insertPayload.full_name,
          email:          insertPayload.email,
          phone:          insertPayload.phone,
          admin_id:       insertPayload.admin_id,
          kyc_status:     'incomplete',
          client_status:  'pending',
        };
        // Only add these if they exist as columns in your DB
        const safeOptional = ['national_id', 'city', 'country', 'address', 'notes', 'created_by'];
        safeOptional.forEach(k => { if (insertPayload[k]) corePayload[k] = insertPayload[k]; });

        const { error: insertErr } = await supabase.from('clients').insert(corePayload);
        if (insertErr) {
          console.error('[AssetFlow] Client insert error:', insertErr);
          throw new Error(insertErr.message || JSON.stringify(insertErr));
        }
        await auditLogsService?.log('create', 'clients', `Created new client ${name}`);
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
            client={editingClient}
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
      </div>
    </MainLayout>
  );
};

export default AssetClientManagement;
