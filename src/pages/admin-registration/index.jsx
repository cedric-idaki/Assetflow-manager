import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import { formatKEPhone } from '../../utils/phoneUtils';

const PLANS = [
  {
    id: 'bronze',
    name: 'Bronze',
    price: 5000,
    maxUsers: 7,
    color: '#CD7F32',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    features: ['Up to 7 users', 'Asset management', 'Client portal', 'Basic reporting'],
  },
  {
    id: 'silver',
    name: 'Silver',
    price: 10000,
    maxUsers: 16,
    color: '#C0C0C0',
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    features: ['Up to 16 users', 'Asset management', 'Client portal', 'Sales agent portal', 'KYC management', 'Advanced reporting'],
    popular: true,
  },
  {
    id: 'gold',
    name: 'Gold',
    price: 20000,
    maxUsers: null,
    color: '#C9A84C',
    bg: 'bg-yellow-50',
    border: 'border-yellow-300',
    features: ['Unlimited users', 'Asset management', 'Client portal', 'Sales agent portal', 'KYC management', 'Full reporting', 'Priority support', 'Custom contracts'],
  },
];

const ASSET_TYPES = [
  'Vehicles', 'Property/Land', 'Construction Dealers',
  'Electronics', 'Furnitures', 'Heavy Equipment',
];

const steps = ['Account', 'Company', 'Plan', 'Payment'];

const AdminRegistration = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Step 1 - Account
  const [account, setAccount] = useState({
    fullName: '', email: '', phone: '', password: '', confirmPassword: '',
  });

  // Step 2 - Company
  const [company, setCompany] = useState({
    companyName: '', businessRegNumber: '', businessType: '',
    location: '', city: '', assetTypes: [],
  });

  // Step 3 - Plan
  const [selectedPlan, setSelectedPlan] = useState(null);

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
      if (!account.password || account.password.length < 6) return setError('Password must be at least 6 characters.') || false;
      if (account.password !== account.confirmPassword) return setError('Passwords do not match.') || false;
    }
    if (currentStep === 1) {
      if (!company.companyName) return setError('Company name is required.') || false;
      if (!company.location) return setError('Location is required.') || false;
      if (company.assetTypes.length === 0) return setError('Select at least one asset type.') || false;
    }
    if (currentStep === 2) {
      if (!selectedPlan) return setError('Please select a plan.') || false;
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
      const plan = PLANS.find(p => p.id === selectedPlan);
      const { data: planData } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('name', selectedPlan)
        .single();

      await supabase.from('company_subscriptions').insert({
        admin_id: userId,
        plan_id: planData?.id,
        plan_name: selectedPlan,
        status: 'pending',
        price_paid: plan.price,
        max_users: plan.maxUsers,
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
    const plan = PLANS.find(p => p.id === selectedPlan);

    try {
      // Save payment record as pending
      await supabase.from('mpesa_subscription_payments').insert({
        admin_id: adminId,
        phone_number: mpesaPhone,
        amount: plan.price,
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
    <div className="min-h-screen bg-background flex">
      {/* Left branding panel */}
      <div
        className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #1E429F 0%, #1A56DB 50%, #1C3FAA 100%)' }}
      >
        <div className="absolute top-0 left-0 right-0 h-1"
          style={{ background: 'linear-gradient(90deg, #FF6B35, #FF8C5A, #FF6B35)' }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg"
              style={{ background: 'linear-gradient(135deg, #FF6B35, #E85D2F)' }}
            >
              <Icon name="Building2" size={24} color="#0A1628" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Merriweather, serif' }}>AssetFlow</h1>
              <p className="text-xs" style={{ color: '#FF8C5A' }}>Business Management Platform</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <div className="w-12 h-0.5 mb-6" style={{ background: '#FF6B35' }} />
          <h2 className="text-3xl font-bold text-white leading-tight mb-4" style={{ fontFamily: 'Merriweather, serif' }}>
            Grow Your Business with AssetFlow
          </h2>
          <p className="text-base leading-relaxed mb-8" style={{ color: '#A8BDD4' }}>
            Manage your assets, clients, and sales team all in one place.
          </p>
          {/* Steps indicator */}
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  i < currentStep ? 'bg-emerald-500 text-white' :
                  i === currentStep ? 'bg-white text-blue-900' :
                  'bg-white/20 text-white/50'
                }`}>
                  {i < currentStep ? <Icon name="Check" size={14} color="white" /> : i + 1}
                </div>
                <span className={`text-sm font-medium ${i <= currentStep ? 'text-white' : 'text-white/40'}`}>
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-xs" style={{ color: '#5A7A9A' }}>
            © {new Date().getFullYear()} AssetFlow. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 overflow-y-auto">
        <div className="w-full max-w-lg">

          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg mb-2"
              style={{ background: 'linear-gradient(135deg, #1B3A6B, #2C5282)' }}
            >
              <Icon name="Building2" size={22} color="white" />
            </div>
            <h1 className="text-xl font-bold text-foreground">AssetFlow</h1>
          </div>

          {/* Step header */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
              Step {currentStep + 1} of {steps.length}
            </p>
            <h2 className="text-2xl font-bold text-foreground">
              {currentStep === 0 && 'Create Your Account'}
              {currentStep === 1 && 'Company Details'}
              {currentStep === 2 && 'Choose Your Plan'}
              {currentStep === 3 && 'Complete Payment'}
            </h2>
            <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${((currentStep + 1) / steps.length) * 100}%`, background: '#1A56DB' }}
              />
            </div>
          </div>

          {/* Error / Success */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-4">
              <Icon name="AlertCircle" size={15} color="currentColor" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm mb-4">
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
                { label: 'Password *', key: 'password', type: 'password', placeholder: 'Min. 6 characters' },
                { label: 'Confirm Password *', key: 'confirmPassword', type: 'password', placeholder: 'Repeat password' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">{field.label}</label>
                  <input
                    type={field.type}
                    value={account[field.key]}
                    onChange={e => setAcc(field.key, field.key === 'phone' ? formatKEPhone(e.target.value) : e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              ))}
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
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">{field.label}</label>
                  <input
                    type="text"
                    value={company[field.key]}
                    onChange={e => setCo(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-2">
                  Asset Types You Deal In *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ASSET_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleAssetType(type)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all text-left ${
                        company.assetTypes.includes(type)
                          ? 'bg-primary/10 border-primary text-primary font-medium'
                          : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
                        company.assetTypes.includes(type) ? 'bg-primary' : 'border border-border'
                      }`}>
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

          {/* ── STEP 2: Plan ── */}
          {currentStep === 2 && (
            <div className="space-y-3">
              {PLANS.map(plan => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-all relative ${
                    selectedPlan === plan.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-xs font-bold"
                      style={{ background: '#1A56DB', color: 'white' }}
                    >
                      Popular
                    </span>
                  )}
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                      style={{ background: plan.color, color: '#fff' }}
                    >
                      {plan.name[0]}
                    </div>
                    <div>
                      <p className="font-bold text-foreground">{plan.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {plan.maxUsers ? `Up to ${plan.maxUsers} users` : 'Unlimited users'}
                      </p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-lg font-bold text-foreground">
                        KES {plan.price.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">per month</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 mt-2">
                    {plan.features.map(f => (
                      <div key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Icon name="Check" size={11} color="#10b981" />
                        {f}
                      </div>
                    ))}
                  </div>
                  {selectedPlan === plan.id && (
                    <div className="absolute top-3 left-3">
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Icon name="Check" size={11} color="white" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ── STEP 3: Payment ── */}
          {currentStep === 3 && (
            <div className="space-y-4">
              {/* Plan summary */}
              {selectedPlan && (() => {
                const plan = PLANS.find(p => p.id === selectedPlan);
                return (
                  <div className="p-4 rounded-xl bg-muted/50 border border-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Selected Plan</p>
                        <p className="font-bold text-foreground">{plan.name} Plan</p>
                        <p className="text-xs text-muted-foreground">
                          {plan.maxUsers ? `Up to ${plan.maxUsers} users` : 'Unlimited users'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-foreground">
                          KES {plan.price.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">per month</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {paymentStatus === 'idle' && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Mpesa Phone Number *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Icon name="Phone" size={15} color="var(--color-muted-foreground)" />
                    </div>
                    <input
                      type="tel"
                      value={mpesaPhone}
                      onChange={e => setMpesaPhone(e.target.value)}
                      placeholder="+254 7XX XXX XXX"
                      className="w-full pl-9 pr-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    You will receive an STK push on this number to confirm payment
                  </p>
                </div>
              )}

              {paymentStatus === 'stk_sent' && (
                <div className="text-center py-6 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                    <Icon name="Smartphone" size={28} color="#059669" />
                  </div>
                  <div>
                    <p className="font-bold text-foreground text-lg">Check your phone!</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      An Mpesa STK push has been sent to
                    </p>
                    <p className="font-bold text-primary">{mpesaPhone}</p>
                    <p className="text-sm text-muted-foreground mt-2">
                      Enter your Mpesa PIN to complete the payment of{' '}
                      <span className="font-bold text-foreground">
                        KES {PLANS.find(p => p.id === selectedPlan)?.price.toLocaleString()}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/login')}
                    className="w-full py-3 rounded-xl text-sm font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
                  >
                    I have completed payment — Go to Login
                  </button>
                  <p className="text-xs text-muted-foreground">
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
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                >
                  <Icon name="ArrowLeft" size={15} color="currentColor" />
                  Back
                </button>
              ) : (
                <button
                  onClick={() => navigate('/login')}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Already have an account? Sign in
                </button>
              )}

              <button
                onClick={handleNext}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60 ml-auto"
                style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
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
    </div>
  );
};

export default AdminRegistration;