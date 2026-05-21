import { supabase } from '../lib/supabase';

// ── Error Handler ─────────────────────────────────────────────────────────────
var handleError = function(error, context) {
  if (!error) return;

  var message = error.message || 'Unknown error';
  var code = error.code || '';

  // Log for debugging
  console.error('[' + context + '] Error:', {
    message: message,
    code: code,
    details: error.details || null,
    hint: error.hint || null,
  });

  // Return user-friendly messages
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    throw new Error('Connection failed. Please check your internet connection.');
  }
  if (code === '23505' || message.includes('duplicate key')) {
    throw new Error('This record already exists. Please check for duplicates.');
  }
  if (code === '23503' || message.includes('foreign key')) {
    throw new Error('Cannot complete this action. This record is linked to other data.');
  }
  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security')) {
    throw new Error('Access denied. You do not have permission to perform this action.');
  }
  if (code === 'PGRST116' || message.includes('not found')) {
    throw new Error('Record not found. It may have been deleted.');
  }
  if (message.includes('JWT') || message.includes('session')) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  throw new Error(message);
};

// ── Safe query wrapper ────────────────────────────────────────────────────────
var safeQuery = async function(queryFn, context) {
  try {
    var result = await queryFn();
    if (result.error) {
      handleError(result.error, context);
    }
    return result.data;
  } catch (err) {
    if (err.message && (
      err.message.includes('Connection failed') ||
      err.message.includes('Access denied') ||
      err.message.includes('already exists') ||
      err.message.includes('not found') ||
      err.message.includes('session has expired') ||
      err.message.includes('linked to other data')
    )) {
      throw err;
    }
    handleError(err, context);
  }
};

// ==================== CLIENTS ====================
export var clientsService = {
  getAll: async function(filters) {
    var f = filters || {};
    return safeQuery(async function() {
      var query = supabase
        .from('clients')
        .select('*, created_by:user_profiles(full_name)')
        .order('created_at', { ascending: false });

      if (f.status) query = query.eq('client_status', f.status);
      if (f.adminId) query = query.eq('admin_id', f.adminId);
      if (f.search) {
        query = query.or(
          'full_name.ilike.%' + f.search + '%,' +
          'account_number.ilike.%' + f.search + '%,' +
          'email.ilike.%' + f.search + '%'
        );
      }
      return query;
    }, 'clientsService.getAll');
  },

  getById: async function(id) {
    return safeQuery(function() {
      return supabase.from('clients').select('*').eq('id', id).single();
    }, 'clientsService.getById');
  },

  create: async function(clientData) {
    return safeQuery(async function() {
      var authResult = await supabase.auth.getUser();
      var user = authResult.data.user;
      return supabase.from('clients').insert({
        account_number: clientData.accountNumber || ('ACC-' + Date.now()),
        full_name: clientData.fullName,
        email: clientData.email ? clientData.email.toLowerCase().trim() : '',
        phone: clientData.phone,
        national_id: clientData.nationalId,
        address: clientData.physicalAddress || clientData.address,
        city: clientData.city,
        country: clientData.country || 'Kenya',
        client_status: clientData.status || 'active',
        notes: clientData.notes || '',
        admin_id: clientData.adminId || user.id,
        created_by: user.id,
        kyc_status: 'unverified',
      }).select().single();
    }, 'clientsService.create');
  },

  update: async function(id, updates) {
    return safeQuery(function() {
      return supabase.from('clients').update({
        full_name: updates.fullName,
        email: updates.email ? updates.email.toLowerCase().trim() : undefined,
        phone: updates.phone,
        national_id: updates.nationalId,
        address: updates.physicalAddress || updates.address,
        city: updates.city,
        client_status: updates.status,
        notes: updates.notes,
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single();
    }, 'clientsService.update');
  },

  delete: async function(id) {
    return safeQuery(function() {
      return supabase.from('clients').delete().eq('id', id);
    }, 'clientsService.delete');
  },

  subscribeToChanges: function(callback) {
    return supabase
      .channel('clients_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, callback)
      .subscribe();
  },
};

// ==================== ASSETS ====================
export var assetsService = {
  getAll: async function(filters) {
    var f = filters || {};
    return safeQuery(async function() {
      var query = supabase
        .from('assets')
        .select('*, linked_client:clients(full_name, account_number), registered_by:user_profiles(full_name)')
        .order('created_at', { ascending: false });

      if (f.status) query = query.eq('asset_status', f.status);
      if (f.type) query = query.eq('asset_type', f.type);
      if (f.adminId) query = query.eq('registered_by', f.adminId);
      if (f.search) {
        query = query.or(
          'description.ilike.%' + f.search + '%,' +
          'asset_code.ilike.%' + f.search + '%'
        );
      }
      return query;
    }, 'assetsService.getAll');
  },

  getById: async function(id) {
    return safeQuery(function() {
      return supabase
        .from('assets')
        .select('*, linked_client:clients(*), registered_by:user_profiles(full_name)')
        .eq('id', id)
        .single();
    }, 'assetsService.getById');
  },

  create: async function(assetData) {
    return safeQuery(async function() {
      var authResult = await supabase.auth.getUser();
      var user = authResult.data.user;
      return supabase.from('assets').insert({
        asset_code: assetData.assetCode || ('AST-' + Date.now()),
        asset_type: assetData.type || 'other',
        description: assetData.description,
        purchase_price: parseFloat(assetData.purchasePrice) || 0,
        selling_price: parseFloat(assetData.sellingPrice) || 0,
        current_value: parseFloat(assetData.currentValue || assetData.sellingPrice) || 0,
        asset_status: assetData.status || 'available',
        location: assetData.location || '',
        make: assetData.make || '',
        model: assetData.model || '',
        year: assetData.year ? parseInt(assetData.year) : null,
        color: assetData.color || '',
        plate_number: assetData.plateNumber || '',
        chassis_number: assetData.chassisNumber || '',
        property_type: assetData.propertyType || '',
        property_size: assetData.propertySize || '',
        notes: assetData.notes || '',
        registered_by: user.id,
      }).select().single();
    }, 'assetsService.create');
  },

  update: async function(id, updates) {
    return safeQuery(function() {
      return supabase.from('assets').update({
        description: updates.description,
        purchase_price: updates.purchasePrice ? parseFloat(updates.purchasePrice) : undefined,
        selling_price: updates.sellingPrice ? parseFloat(updates.sellingPrice) : undefined,
        current_value: updates.currentValue ? parseFloat(updates.currentValue) : undefined,
        asset_status: updates.status,
        location: updates.location,
        make: updates.make,
        model: updates.model,
        year: updates.year ? parseInt(updates.year) : undefined,
        color: updates.color,
        plate_number: updates.plateNumber,
        notes: updates.notes,
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single();
    }, 'assetsService.update');
  },

  linkToClient: async function(assetId, clientId) {
    return safeQuery(function() {
      return supabase
        .from('assets')
        .update({ linked_client_id: clientId, asset_status: 'reserved' })
        .eq('id', assetId)
        .select()
        .single();
    }, 'assetsService.linkToClient');
  },

  delete: async function(id) {
    return safeQuery(function() {
      return supabase.from('assets').delete().eq('id', id);
    }, 'assetsService.delete');
  },

  subscribeToChanges: function(callback) {
    return supabase
      .channel('assets_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, callback)
      .subscribe();
  },

  // ── BRS 9.2 — Status Management Functions ──────────────────────────────────

  // Mark as Reserved when POS initiated (before payment confirmed)
  reserve: async function(assetId, reason) {
    var authResult = await supabase.auth.getUser();
    var userId = authResult.data.user?.id;
    return safeQuery(function() {
      return supabase.from('assets').update({
        asset_status:           'reserved',
        last_status_change_by:  userId,
        last_status_reason:     reason || 'Reserved — POS sale initiated',
        updated_at:             new Date().toISOString(),
      }).eq('id', assetId).select().single();
    }, 'assetsService.reserve');
  },

  // Mark as Sold when cash sale confirmed
  markSold: async function(assetId, reason) {
    var authResult = await supabase.auth.getUser();
    var userId = authResult.data.user?.id;
    return safeQuery(function() {
      return supabase.from('assets').update({
        asset_status:           'sold',
        quantity_available:     0,
        last_status_change_by:  userId,
        last_status_reason:     reason || 'Sold — cash sale confirmed',
        updated_at:             new Date().toISOString(),
      }).eq('id', assetId).select().single();
    }, 'assetsService.markSold');
  },

  // Mark as On Installment when hire purchase deposit confirmed
  markOnInstallment: async function(assetId, reason) {
    var authResult = await supabase.auth.getUser();
    var userId = authResult.data.user?.id;
    return safeQuery(function() {
      return supabase.from('assets').update({
        asset_status:           'on_installment',
        last_status_change_by:  userId,
        last_status_reason:     reason || 'On Installment — deposit confirmed',
        updated_at:             new Date().toISOString(),
      }).eq('id', assetId).select().single();
    }, 'assetsService.markOnInstallment');
  },

  // Release reservation (e.g. cancelled POS before payment)
  releaseReservation: async function(assetId, reason) {
    var authResult = await supabase.auth.getUser();
    var userId = authResult.data.user?.id;
    return safeQuery(function() {
      return supabase.from('assets')
        .update({
          asset_status:           'available',
          last_status_change_by:  userId,
          last_status_reason:     reason || 'Reservation released — sale cancelled',
          updated_at:             new Date().toISOString(),
        })
        .eq('id', assetId)
        .eq('asset_status', 'reserved')  // only release if currently reserved
        .select().single();
    }, 'assetsService.releaseReservation');
  },

  // Get full status history for an asset
  getStatusHistory: async function(assetId) {
    return safeQuery(function() {
      return supabase.from('assets')
        .select('asset_code, description, asset_status, status_history, reserved_at, sold_at')
        .eq('id', assetId)
        .single();
    }, 'assetsService.getStatusHistory');
  },

  // Get assets by status (for dashboard widgets)
  getByStatus: async function(status, adminId) {
    return safeQuery(function() {
      var query = supabase.from('assets')
        .select('id, asset_code, description, asset_type, asset_status, selling_price, quantity_available')
        .eq('asset_status', status)
        .order('updated_at', { ascending: false });
      if (adminId) query = query.eq('registered_by', adminId);
      return query;
    }, 'assetsService.getByStatus');
  },

  // Update quantity (with oversell protection)
  updateQuantity: async function(assetId, delta, reason) {
    // delta = -1 to reduce by 1, +1 to restore
    var authResult = await supabase.auth.getUser();
    var userId = authResult.data.user?.id;
    return safeQuery(async function() {
      // First get current quantity
      var { data: asset } = await supabase.from('assets')
        .select('quantity_available, description')
        .eq('id', assetId)
        .single();
      var newQty = (asset?.quantity_available || 0) + delta;
      if (newQty < 0) throw new Error(
        'Cannot reduce quantity below zero for ' + asset?.description + '. Oversell prevented.'
      );
      return supabase.from('assets').update({
        quantity_available:     newQty,
        last_status_change_by:  userId,
        last_status_reason:     reason || ('Quantity updated by ' + delta),
        updated_at:             new Date().toISOString(),
      }).eq('id', assetId).select().single();
    }, 'assetsService.updateQuantity');
  },
};

// ==================== PAYMENTS ====================
export var paymentsService = {
  getAll: async function(filters) {
    var f = filters || {};
    return safeQuery(async function() {
     var query = supabase
  .from('payments')
  .select('*, client:clients(full_name, account_number), asset:assets(description, asset_code), processor:user_profiles!payments_processed_by_fkey(full_name)')
  .order('payment_date', { ascending: false });

      if (f.status) query = query.eq('payment_status', f.status);
      if (f.clientId) query = query.eq('client_id', f.clientId);
      if (f.search) {
        query = query.or(
          'transaction_id.ilike.%' + f.search + '%,' +
          'reference_number.ilike.%' + f.search + '%'
        );
      }
      return query;
    }, 'paymentsService.getAll');
  },

  create: async function(paymentData) {
    return safeQuery(async function() {
      var authResult = await supabase.auth.getUser();
      var user = authResult.data.user;

      if (!paymentData.clientId) throw new Error('Client ID is required for payment.');
      if (!paymentData.amount || parseFloat(paymentData.amount) <= 0) {
        throw new Error('Payment amount must be greater than 0.');
      }

      return supabase.from('payments').insert({
        transaction_id: 'TXN-' + Date.now(),
        client_id: paymentData.clientId,
        asset_id: paymentData.assetId || null,
        agent_id: paymentData.agentId || null,
        amount: parseFloat(paymentData.amount),
        payment_method: paymentData.paymentMethod || 'cash',
        payment_status: paymentData.status || 'pending',
        reference_number: paymentData.referenceNumber || '',
        notes: paymentData.notes || '',
        processed_by: user.id,
        payment_date: new Date().toISOString(),
      }).select().single();
    }, 'paymentsService.create');
  },

  updateStatus: async function(id, status, approvedBy) {
    return safeQuery(function() {
      return supabase
        .from('payments')
        .update({
          payment_status: status,
          approved_by: approvedBy || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
    }, 'paymentsService.updateStatus');
  },

  subscribeToChanges: function(callback) {
    return supabase
      .channel('payments_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, callback)
      .subscribe();
  },
};

// ==================== AGENTS ====================
export var agentsService = {
  getAll: async function(filters) {
    var f = filters || {};
    return safeQuery(async function() {
      var query = supabase
        .from('agents')
        .select('*, user:user_profiles(email)')
        .order('created_at', { ascending: false });

      if (f.status) query = query.eq('agent_status', f.status);
      if (f.adminId) query = query.eq('admin_id', f.adminId);
      if (f.search) {
        query = query.or(
          'full_name.ilike.%' + f.search + '%,' +
          'agent_code.ilike.%' + f.search + '%'
        );
      }
      return query;
    }, 'agentsService.getAll');
  },

  create: async function(agentData) {
    return safeQuery(async function() {
      var authResult = await supabase.auth.getUser();
      var user = authResult.data.user;

      if (!agentData.fullName || agentData.fullName.trim() === '') {
        throw new Error('Agent full name is required.');
      }
      if (!agentData.email || agentData.email.trim() === '') {
        throw new Error('Agent email is required.');
      }

      return supabase.from('agents').insert({
        agent_code: 'AGT-' + Date.now(),
        full_name: agentData.fullName.trim(),
        email: agentData.email.toLowerCase().trim(),
        phone: agentData.phone || '',
        agent_status: agentData.status || 'active',
        commission_rate: parseFloat(agentData.commissionRate) || 5.00,
        target_amount: parseFloat(agentData.targetAmount) || 0,
        region: agentData.region || '',
        admin_id: agentData.adminId || user.id,
      }).select().single();
    }, 'agentsService.create');
  },

  update: async function(id, updates) {
    return safeQuery(function() {
      return supabase.from('agents').update({
        full_name: updates.fullName,
        phone: updates.phone,
        agent_status: updates.status,
        commission_rate: updates.commissionRate ? parseFloat(updates.commissionRate) : undefined,
        target_amount: updates.targetAmount ? parseFloat(updates.targetAmount) : undefined,
        region: updates.region,
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single();
    }, 'agentsService.update');
  },

  subscribeToChanges: function(callback) {
    return supabase
      .channel('agents_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, callback)
      .subscribe();
  },
};

// ==================== AUDIT LOGS ====================
export var auditLogsService = {
  getAll: async function(filters) {
    var f = filters || {};
    return safeQuery(async function() {
      var query = supabase
        .from('audit_logs')
        .select('*, user:user_profiles(full_name, email, role)')
        .order('created_at', { ascending: false })
        .limit(200);

      if (f.action) query = query.eq('action', f.action);
      if (f.userId) query = query.eq('user_id', f.userId);
      if (f.clientId) query = query.eq('client_id', f.clientId);
      if (f.kycOnly) {
        query = query.in('action', ['kyc_document_upload', 'kyc_status_change', 'kyc_renewal', 'kyc_verification']);
      }
      return query;
    }, 'auditLogsService.getAll');
  },

  // ── UPDATED: now saves admin_id so each company sees only their own logs ──
  log: async function(action, tableName, description, recordId, oldValues, newValues) {
    try {
      var authResult = await supabase.auth.getUser();
      var user = authResult.data.user;
      if (!user) return;

      // Get admin_id from auth metadata first (faster, no RLS issues)
      // Falls back to user's own id if no admin_id found
     var profileResult = await supabase
        .from('user_profiles')
        .select('admin_id')
        .eq('id', user.id)
        .single();

      // If user has admin_id they are staff — use that as the company identifier
      // If admin_id is null they ARE the admin — use their own id
      var adminId = profileResult.data?.admin_id || user.id;

      var result = await supabase.from('audit_logs').insert({
        user_id:     user.id,
        admin_id:    adminId,
        action:      action,
        table_name:  tableName,
        record_id:   recordId  || null,
        old_values:  oldValues || null,
        new_values:  newValues || null,
        description: description,
        severity:    'info',
      });

      if (result.error) {
        console.warn('[auditLogsService.log] Failed to log audit:', result.error.message);
      }
    } catch (err) {
      // Never throw from audit log — it should not break the main flow
      console.warn('[auditLogsService.log] Audit log error:', err.message);
    }
  },

  // ── UPDATED: now saves admin_id for company isolation ────────────────────
  logKYCAction: async function(action, clientId, clientName, description, metadata, severity) {
    try {
      var authResult = await supabase.auth.getUser();
      var user = authResult.data.user;
      if (!user) return;

      var profileResult = await supabase
        .from('user_profiles')
        .select('admin_id')
        .eq('id', user.id)
        .single();

      // If user has admin_id they are staff — use that as the company identifier
      // If admin_id is null they ARE the admin — use their own id
      var adminId = profileResult.data?.admin_id || user.id;

      var result = await supabase.from('audit_logs').insert({
        user_id:     user.id,
        admin_id:    adminId,
        action:      action,
        table_name:  action === 'kyc_document_upload' ? 'kyc_documents' : 'clients',
        client_id:   clientId   || null,
        client_name: clientName || null,
        description: description,
        severity:    severity   || 'info',
        metadata:    metadata   || {},
      });

      if (result.error) {
        console.warn('[auditLogsService.logKYCAction] Failed:', result.error.message);
      }
    } catch (err) {
      console.warn('[auditLogsService.logKYCAction] Error:', err.message);
    }
  },

  subscribeToChanges: function(callback) {
    return supabase
      .channel('audit_logs_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, callback)
      .subscribe();
  },
};

// ==================== DASHBOARD STATS ====================
export var dashboardService = {
  getStats: async function() {
    return safeQuery(async function() {
      var results = await Promise.all([
        supabase.from('clients').select('*', { count: 'exact', head: true }),
        supabase.from('assets').select('*', { count: 'exact', head: true }),
        supabase.from('payments').select('amount, payment_status'),
        supabase.from('agents').select('*', { count: 'exact', head: true }).eq('agent_status', 'active'),
      ]);

      var clientsRes  = results[0];
      var assetsRes   = results[1];
      var paymentsRes = results[2];
      var agentsRes   = results[3];

      var payments = paymentsRes.data || [];
      var totalCollected = payments
        .filter(function(p) { return p.payment_status === 'completed'; })
        .reduce(function(sum, p) { return sum + parseFloat(p.amount || 0); }, 0);
      var pendingPayments = payments
        .filter(function(p) { return p.payment_status === 'pending'; })
        .reduce(function(sum, p) { return sum + parseFloat(p.amount || 0); }, 0);

      return {
        data: {
          totalClients: clientsRes.count || 0,
          totalAssets: assetsRes.count || 0,
          totalCollected: totalCollected,
          pendingPayments: pendingPayments,
          activeAgents: agentsRes.count || 0,
        }
      };
    }, 'dashboardService.getStats');
  },
};