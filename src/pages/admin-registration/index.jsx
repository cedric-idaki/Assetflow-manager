import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import TermsModal from '../../components/TermsModal';
import { formatKEPhone } from '../../utils/phoneUtils';
import { COMPANY_PLANS as PLANS, planForUsers, INSTALLATION_FEE } from '../../config/companyPlans';

// Pricing is per user, per tier (KES / user / month). The number of users the
// admin needs automatically selects the plan tier (which sets the free storage
// quota). On first-time registration a one-time installation fee is also charged.
// Total payable today = (users × tier price per user) + installation fee.
// Plan catalog + tier selection live in src/config/companyPlans.js (shared with
// the admin profile so pricing stays in sync).

const ASSET_TYPES = [
  'Vehicles', 'Property/Land', 'Construction Dealers',
  'Electronics', 'Furnitures', 'Heavy Equipment',
];

const steps = ['Account', 'Company', 'Plan', 'Payment'];

// ── System colors (matching LoginPage) ──────────────────────────────
const C = {
  primary:     '#34c1dd',
  primaryDark: '#1da8c5',
  navy:        '#0c2037',
  navyMid:     '#1a3a5c',
  bg:          '#f5f8fa',
  card:        '#ffffff',
  border:      '#d0dce6',
  inputBg:     '#f5f8fa',
  text:        '#0c2037',
  textMuted:   '#5a7185',
  error:       '#b91c1c',
  errorBg:     '#fef2f2',
  errorBorder: '#fecaca',
};

const AdminRegistration = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Step 1 - Account
  const [account, setAccount] = useState({
    fullName: '', email: '', phone: '', gender: '', password: '', confirmPassword: '',
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  // Step 2 - Company
  const [company, setCompany] = useState({
    companyName: '', businessRegNumber: '', businessType: '',
    location: '', city: '', assetTypes: [],
  });

  // Step 3 - Plan (number of users drives the tier + price)
  const [numberOfUsers, setNumberOfUsers] = useState('');
  const userCount = parseInt(numberOfUsers, 10) || 0;
  const activePlan = planForUsers(userCount);
  // Registration is always a first-time signup, so the one-time installation
  // fee always applies here. Renewals (handled elsewhere) must NOT re-charge it.
  const subscriptionPrice = activePlan ? userCount * activePlan.pricePerUser : 0;
  const installationFee = activePlan ? INSTALLATION_FEE : 0;
  const totalPrice = subscriptionPrice + installationFee;

  // Step 4 - Payment
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('idle');
  const [createdAdminId, setCreatedAdminId] = useState(null);

  const setAcc = (k, v) => setAccount(prev => ({ ...prev, [k]: v }));
  const setCo = (k, v) => setCompany(prev => ({ ...prev, [k]: v }));

  const toggleAssetType = (type) => {
    setCo('assetTypes', company.assetTypes.includes(type)
      ? company.assetTypes.filter(t => t !== type)
      : [...company.assetTypes, type]
    );
  };

  // ── Validate each step ──────────────────────────────────────────────────────
  const validateStep = () => {
    setError('');
    if (currentStep === 0) {
      if (!account.fullName) return setError('Full name is required.') || false;
      if (!account.email) return setError('Email is required.') || false;
      if (!account.phone) return setError('Phone number is required.') || false;
      if (!account.gender) return setError('Please select your gender.') || false;
      if (!account.password || account.password.length < 6) return setError('Password must be at least 6 characters.') || false;
      if (account.password !== account.confirmPassword) return setError('Passwords do not match.') || false;
      if (!termsAccepted) return setError('You must accept the Terms & Privacy Policy to continue.') || false;
    }
    if (currentStep === 1) {
      if (!company.companyName) return setError('Company name is required.') || false;
      if (!company.location) return setError('Location is required.') || false;
      if (company.assetTypes.length === 0) return setError('Select at least one asset type.') || false;
    }
    if (currentStep === 2) {
      if (!userCount || userCount < 1) return setError('Enter the number of users you need (minimum 1).') || false;
      if (!activePlan) return setError('Could not determine a plan for that number of users.') || false;
    }
    if (currentStep === 3) {
      if (!mpesaPhone || mpesaPhone.length < 10) return setError('Enter a valid Mpesa phone number.') || false;
    }
    return true;
  };

  // ── Create admin account ────────────────────────────────────────────────────
  const createAdminAccount = async () => {
    setLoading(true);
    try {
      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: account.email,
        password: account.password,
        options: {
          data: { full_name: account.fullName, role: 'admin' },
        },
      });
      if (authError) throw authError;

      const userId = authData.user.id;
      setCreatedAdminId(userId);

      // 2. Update user profile with role
      await supabase.from('user_profiles').upsert({
        id: userId,
        email: account.email,
        full_name: account.fullName,
        phone: account.phone,
        gender: account.gender, // 'male' | 'female'
        role: 'admin',
        is_active: false, // inactive until payment confirmed
      });

      // 3. Create company profile
      await supabase.from('company_profiles').insert({
        admin_id: userId,
        company_name: company.companyName,
        business_registration_number: company.businessRegNumber,
        business_type: company.businessType,
        asset_types: company.assetTypes,
        email: account.email,
        phone: account.phone,
        location: company.location,
        city: company.city,
        kyc_status: 'pending',
      });

      // 4. Create pending subscription
      const { data: planData } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('name', activePlan.id)
        .single();

      await supabase.from('company_subscriptions').insert({
        admin_id: userId,
        plan_id: planData?.id,
        plan_name: activePlan.id,
        status: 'pending',
        price_paid: totalPrice,
        max_users: userCount, // seats the admin paid for
        start_date: new Date().toISOString(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      return userId;
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // ── Trigger Mpesa STK Push ─────────────────────────────────────────────────
  const triggerMpesaPayment = async (adminId) => {
    setPaymentStatus('processing');

    try {
      // Save payment record as pending
      await supabase.from('mpesa_subscription_payments').insert({
        admin_id: adminId,
        phone_number: mpesaPhone,
        amount: totalPrice,
        status: 'pending',
      });

      // In production this calls your Mpesa Daraja API
      // For now we simulate the STK push was sent
      setPaymentStatus('stk_sent');
      setSuccess(`STK push sent to ${mpesaPhone}. Enter your Mpesa PIN to complete payment.`);

    } catch (err) {
      setPaymentStatus('failed');
      setError('Failed to initiate Mpesa payment. Please try again.');
    }
  };

  // ── Handle Next ────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (!validateStep()) return;

    if (currentStep === 2) {
      // Create account before going to payment step
      setLoading(true);
      try {
        const adminId = await createAdminAccount();
        setCreatedAdminId(adminId);
        setCurrentStep(3);
      } catch (err) {
        setError(err.message || 'Registration failed. Please try again.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (currentStep === 3) {
      await triggerMpesaPayment(createdAdminId);
      return;
    }

    setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    setError('');
    setCurrentStep(prev => prev - 1);
  };

  return (
    <div className="min-h-screen flex" style={{ background: C.card }}>
      {/* Left branding panel */}
      <div
        className="hidden lg:flex lg:w-[52%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: `linear-gradient(160deg, ${C.navy} 0%, ${C.navyMid} 60%, ${C.navy} 100%)` }}
      >
        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-1"
          style={{ background: `linear-gradient(90deg, ${C.primary}, #5dd3e8, ${C.primary})` }}
        />

        {/* Decorative circles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-16 right-16 w-72 h-72 rounded-full"
            style={{ border: '1.5px solid rgba(52,193,221,0.08)' }} />
          <div className="absolute top-32 right-32 w-44 h-44 rounded-full"
            style={{ border: '1px solid rgba(52,193,221,0.06)' }} />
          <div className="absolute bottom-32 left-8 w-56 h-56 rounded-full"
            style={{ border: '1px solid rgba(52,193,221,0.06)' }} />
          <div className="absolute bottom-16 left-24 w-32 h-32 rounded-full"
            style={{ border: '1px solid rgba(52,193,221,0.04)' }} />
          {/* Glow blob */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(52,193,221,0.06) 0%, transparent 70%)' }} />
        </div>

        {/* Brand */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`, boxShadow: '0 4px 14px rgba(52,193,221,0.35)' }}>
            <Icon name="Building2" size={24} color={C.navy} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AssetFlow</h1>
            <p className="text-xs" style={{ color: C.primary }}>Business Management Platform</p>
          </div>
        </div>

        {/* Headline */}
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <div className="w-12 h-0.5 mb-6" style={{ background: C.primary }} />
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Grow Your Business with AssetFlow
          </h2>
          <p className="text-base leading-relaxed mb-10" style={{ color: '#7a9cb8' }}>
            Manage your assets, clients, and sales team all in one place.
          </p>

          {/* Steps indicator */}
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  i < currentStep ? 'text-white' : 'text-white'
                }`}
                  style={{
                    background: i < currentStep 
                      ? '#10b981'
                      : i === currentStep
                      ? C.primary
                      : 'rgba(52,193,221,0.15)',
                  }}>
                  {i < currentStep ? <Icon name="Check" size={14} color="white" /> : i + 1}
                </div>
                <span className="text-sm font-medium" style={{ color: i <= currentStep ? 'white' : 'rgba(255,255,255,0.4)' }}>
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-xs" style={{ color: '#3a5a7a' }}>
            © {new Date().getFullYear()} AssetFlow. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 overflow-y-auto" style={{ background: C.card }}>
        <div className="w-full max-w-lg">

          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg mb-2"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})` }}>
              <Icon name="Building2" size={22} color="white" />
            </div>
            <h1 className="text-xl font-bold" style={{ color: C.navy }}>AssetFlow</h1>
          </div>

          {/* Step header */}
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.primary }}>
              Step {currentStep + 1} of {steps.length}
            </p>
            <h2 className="text-2xl font-bold mb-3" style={{ color: C.navy }}>
              {currentStep === 0 && 'Create Your Account'}
              {currentStep === 1 && 'Company Details'}
              {currentStep === 2 && 'Choose Your Plan'}
              {currentStep === 3 && 'Complete Payment'}
            </h2>
            <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: C.border }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${((currentStep + 1) / steps.length) * 100}%`, background: `linear-gradient(90deg, ${C.primary}, ${C.primaryDark})` }}
              />
            </div>
          </div>

          {/* Error / Success */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm mb-4"
              style={{ background: C.errorBg, border: `1px solid ${C.errorBorder}`, color: C.error }}>
              <Icon name="AlertCircle" size={15} color="currentColor" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm mb-4"
              style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#15803d' }}>
              <Icon name="CheckCircle" size={15} color="currentColor" />
              {success}
            </div>
          )}

          {/* ── STEP 0: Account ── */}
          {currentStep === 0 && (
            <div className="space-y-4">
              {[
                { label: 'Full Name *', key: 'fullName', type: 'text', placeholder: 'John Kamau' },
                { label: 'Email Address *', key: 'email', type: 'email', placeholder: 'john@company.com' },
                { label: 'Phone Number *', key: 'phone', type: 'tel', placeholder: '+254 7XX XXX XXX' },
                { label: 'Gender *', key: 'gender', type: 'select', options: [
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ] },
                { label: 'Password *', key: 'password', type: 'password', placeholder: 'Min. 6 characters' },
                { label: 'Confirm Password *', key: 'confirmPassword', type: 'password', placeholder: 'Repeat password' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: C.navy }}>{field.label}</label>
                  {field.type === 'select' ? (
                    <select
                      value={account[field.key]}
                      onChange={e => setAcc(field.key, e.target.value)}
                      className="w-full px-3 py-2.5 text-sm rounded-lg focus:outline-none transition-all"
                      style={{
                        border: `1.5px solid ${C.border}`,
                        color: account[field.key] ? C.text : C.textMuted,
                        background: C.inputBg,
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = C.primary;
                        e.target.style.boxShadow = '0 0 0 3px rgba(52,193,221,0.15)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = C.border;
                        e.target.style.boxShadow = 'none';
                      }}
                    >
                      <option value="" disabled>Select gender</option>
                      {field.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={account[field.key]}
                      onChange={e => setAcc(field.key, field.key === 'phone' ? formatKEPhone(e.target.value) : e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2.5 text-sm rounded-lg focus:outline-none transition-all"
                      style={{
                        border: `1.5px solid ${C.border}`,
                        color: C.text,
                        background: C.inputBg,
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = C.primary;
                        e.target.style.boxShadow = '0 0 0 3px rgba(52,193,221,0.15)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = C.border;
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                  )}
                </div>
              ))}

              {/* Terms & Privacy acceptance */}
              <label className="flex items-start gap-3 cursor-pointer pt-1">
                <span
                  className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                  style={{
                    background: termsAccepted ? C.primary : 'transparent',
                    border: `1.5px solid ${termsAccepted ? C.primary : C.border}`,
                  }}
                >
                  {termsAccepted && <Icon name="Check" size={12} color="white" />}
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={e => setTermsAccepted(e.target.checked)}
                    className="sr-only"
                  />
                </span>
                <span className="text-sm leading-snug" style={{ color: C.textMuted }}>
                  I have read and agree to the{' '}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setShowTerms(true); }}
                    className="font-semibold underline underline-offset-2"
                    style={{ color: C.primary }}
                  >
                    Terms &amp; Privacy Policy
                  </button>
                  .
                </span>
              </label>
            </div>
          )}

          {/* ── STEP 1: Company ── */}
          {currentStep === 1 && (
            <div className="space-y-4">
              {[
                { label: 'Company Name *', key: 'companyName', placeholder: 'Acme Ltd' },
                { label: 'Business Registration Number', key: 'businessRegNumber', placeholder: 'e.g. CPR/2024/001' },
                { label: 'Business Type', key: 'businessType', placeholder: 'e.g. Limited Company, Sole Proprietor' },
                { label: 'Location / Address *', key: 'location', placeholder: 'e.g. Westlands, Nairobi' },
                { label: 'City', key: 'city', placeholder: 'Nairobi' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: C.navy }}>{field.label}</label>
                  <input
                    type="text"
                    value={company[field.key]}
                    onChange={e => setCo(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2.5 text-sm rounded-lg focus:outline-none transition-all"
                    style={{
                      border: `1.5px solid ${C.border}`,
                      color: C.text,
                      background: C.inputBg,
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = C.primary;
                      e.target.style.boxShadow = '0 0 0 3px rgba(52,193,221,0.15)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = C.border;
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: C.navy }}>
                  Asset Types You Deal In *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ASSET_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleAssetType(type)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all text-left"
                      style={{
                        background: company.assetTypes.includes(type) ? 'rgba(52,193,221,0.1)' : C.inputBg,
                        border: `1px solid ${company.assetTypes.includes(type) ? C.primary : C.border}`,
                        color: company.assetTypes.includes(type) ? C.primary : C.text,
                        fontWeight: company.assetTypes.includes(type) ? '500' : '400',
                      }}
                    >
                      <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                        style={{
                          background: company.assetTypes.includes(type) ? C.primary : 'transparent',
                          border: company.assetTypes.includes(type) ? 'none' : `1px solid ${C.border}`,
                        }}>
                        {company.assetTypes.includes(type) && (
                          <Icon name="Check" size={10} color="white" />
                        )}
                      </div>
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Plan (auto-selected from number of users) ── */}
          {currentStep === 2 && (
            <div className="space-y-4">
              {/* Number of users */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: C.navy }}>
                  Number of Users *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Icon name="Users" size={15} color={C.textMuted} />
                  </div>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={numberOfUsers}
                    onChange={e => setNumberOfUsers(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="e.g. 8"
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg focus:outline-none transition-all"
                    style={{ border: `1.5px solid ${C.border}`, color: C.text, background: C.inputBg }}
                    onFocus={(e) => {
                      e.target.style.borderColor = C.primary;
                      e.target.style.boxShadow = '0 0 0 3px rgba(52,193,221,0.15)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = C.border;
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                </div>
                <p className="text-xs mt-1" style={{ color: C.textMuted }}>
                  How many staff login accounts you need. Your plan is chosen automatically.
                </p>
              </div>

              {/* Auto-selected plan + total */}
              {activePlan ? (
                <div className="p-4 rounded-xl" style={{ background: 'rgba(52,193,221,0.06)', border: `1.5px solid ${C.primary}` }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                      style={{ background: activePlan.color, color: '#fff' }}>
                      {activePlan.name[0]}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.primary }}>
                        Your Plan
                      </p>
                      <p className="font-bold" style={{ color: C.navy }}>{activePlan.name}</p>
                      <p className="text-xs" style={{ color: C.textMuted }}>
                        {activePlan.userRange} · {activePlan.storageGb} GB free
                      </p>
                    </div>
                  </div>

                  {/* Price breakdown */}
                  <div className="mt-4 pt-3 space-y-2" style={{ borderTop: `1px solid ${C.border}` }}>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: C.textMuted }}>
                        Monthly subscription · {userCount} × KES {activePlan.pricePerUser}
                      </span>
                      <span className="font-semibold" style={{ color: C.navy }}>
                        KES {subscriptionPrice.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: C.textMuted }}>
                        Installation fee · one-time
                      </span>
                      <span className="font-semibold" style={{ color: C.navy }}>
                        KES {installationFee.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.border}` }}>
                      <span className="text-sm font-bold" style={{ color: C.navy }}>Total due today</span>
                      <span className="text-2xl font-bold" style={{ color: C.navy }}>
                        KES {totalPrice.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl text-sm text-center"
                  style={{ background: C.bg, border: `1px dashed ${C.border}`, color: C.textMuted }}>
                  Enter the number of users to see your plan and price.
                </div>
              )}

              {/* All tiers for reference (active one highlighted) */}
              <div className="space-y-2">
                {PLANS.map(plan => {
                  const isActive = activePlan?.id === plan.id;
                  return (
                    <div
                      key={plan.id}
                      className="w-full p-3 rounded-xl border-2 text-left relative transition-all"
                      style={{
                        borderColor: isActive ? C.primary : C.border,
                        background: isActive ? 'rgba(52,193,221,0.05)' : C.card,
                        opacity: !activePlan || isActive ? 1 : 0.55,
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs"
                          style={{ background: plan.color, color: '#fff' }}>
                          {plan.name[0]}
                        </div>
                        <div>
                          <p className="font-bold text-sm" style={{ color: C.navy }}>{plan.name}</p>
                          <p className="text-xs" style={{ color: C.textMuted }}>
                            {plan.userRange} · {plan.storageGb} GB free
                          </p>
                        </div>
                        <div className="ml-auto text-right">
                          <p className="text-sm font-bold" style={{ color: C.navy }}>KES {plan.pricePerUser}</p>
                          <p className="text-xs" style={{ color: C.textMuted }}>per user / month</p>
                        </div>
                      </div>
                      {isActive && (
                        <div className="absolute top-2 right-2">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: C.primary }}>
                            <Icon name="Check" size={11} color="white" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STEP 3: Payment ── */}
          {currentStep === 3 && (
            <div className="space-y-4">
              {/* Plan summary */}
              {activePlan && (
                <div className="p-4 rounded-xl" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                  <div>
                    <p className="text-xs" style={{ color: C.textMuted }}>Selected Plan</p>
                    <p className="font-bold" style={{ color: C.navy }}>{activePlan.name} Plan</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>
                      {userCount} users · {activePlan.storageGb} GB free storage
                    </p>
                  </div>

                  {/* Price breakdown */}
                  <div className="mt-3 pt-3 space-y-2" style={{ borderTop: `1px solid ${C.border}` }}>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: C.textMuted }}>
                        Monthly subscription · {userCount} × KES {activePlan.pricePerUser}
                      </span>
                      <span className="font-semibold" style={{ color: C.navy }}>
                        KES {subscriptionPrice.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: C.textMuted }}>Installation fee · one-time</span>
                      <span className="font-semibold" style={{ color: C.navy }}>
                        KES {installationFee.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.border}` }}>
                      <span className="text-sm font-bold" style={{ color: C.navy }}>Total due today</span>
                      <span className="text-2xl font-bold" style={{ color: C.navy }}>
                        KES {totalPrice.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {paymentStatus === 'idle' && (
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: C.navy }}>
                    Mpesa Phone Number *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Icon name="Phone" size={15} color={C.textMuted} />
                    </div>
                    <input
                      type="tel"
                      value={mpesaPhone}
                      onChange={e => setMpesaPhone(e.target.value)}
                      placeholder="+254 7XX XXX XXX"
                      className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg focus:outline-none transition-all"
                      style={{
                        border: `1.5px solid ${C.border}`,
                        color: C.text,
                        background: C.inputBg,
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = C.primary;
                        e.target.style.boxShadow = '0 0 0 3px rgba(52,193,221,0.15)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = C.border;
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <p className="text-xs mt-1" style={{ color: C.textMuted }}>
                    You will receive an STK push on this number to confirm payment
                  </p>
                </div>
              )}

              {paymentStatus === 'stk_sent' && (
                <div className="text-center py-6 space-y-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                    style={{ background: 'rgba(52,193,221,0.12)' }}>
                    <Icon name="Smartphone" size={28} color={C.primary} />
                  </div>
                  <div>
                    <p className="font-bold text-lg" style={{ color: C.navy }}>Check your phone!</p>
                    <p className="text-sm mt-1" style={{ color: C.textMuted }}>
                      An Mpesa STK push has been sent to
                    </p>
                    <p className="font-bold" style={{ color: C.primary }}>{mpesaPhone}</p>
                    <p className="text-sm mt-2" style={{ color: C.textMuted }}>
                      Enter your Mpesa PIN to complete the payment of{' '}
                      <span className="font-bold" style={{ color: C.navy }}>
                        KES {totalPrice.toLocaleString()}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/login')}
                    className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all"
                    style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`, boxShadow: '0 4px 14px rgba(52,193,221,0.35)' }}
                  >
                    I have completed payment — Go to Login
                  </button>
                  <p className="text-xs" style={{ color: C.textMuted }}>
                    Your account will be activated within a few minutes after payment confirmation
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          {paymentStatus !== 'stk_sent' && (
            <div className="flex items-center justify-between mt-6 gap-3">
              {currentStep > 0 ? (
                <button
                  onClick={handleBack}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    border: `1px solid ${C.border}`,
                    color: C.textMuted,
                    background: C.card,
                  }}
                >
                  <Icon name="ArrowLeft" size={15} color="currentColor" />
                  Back
                </button>
              ) : (
                <button
                  onClick={() => navigate('/login')}
                  className="text-sm transition-colors"
                  style={{ color: C.textMuted }}
                >
                  Already have an account? Sign in
                </button>
              )}

              <button
                onClick={handleNext}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold text-white transition-all disabled:opacity-60 ml-auto"
                style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`, boxShadow: '0 4px 14px rgba(52,193,221,0.35)' }}
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                    </svg>
                    Processing...
                  </>
                ) : currentStep === steps.length - 1 ? (
                  <>
                    <Icon name="Smartphone" size={15} color="currentColor" />
                    Send Mpesa STK Push
                  </>
                ) : (
                  <>
                    Continue
                    <Icon name="ArrowRight" size={15} color="currentColor" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      <TermsModal open={showTerms} onClose={() => setShowTerms(false)} />
    </div>
  );
};

export default AdminRegistration;

