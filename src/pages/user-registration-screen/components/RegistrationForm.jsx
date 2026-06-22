import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import Icon from '../../../components/AppIcon';
import TermsModal from '../../../components/TermsModal';
import PasswordStrengthMeter from './PasswordStrengthMeter';

const RegistrationForm = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    agreeTerms: false,
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re?.test(email);
  };

  const validatePassword = (password) => {
    return (password?.length >= 8 &&
    /[A-Z]/?.test(password) &&
    /[a-z]/?.test(password) &&
    /[0-9]/?.test(password) && /[^A-Za-z0-9]/?.test(password));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData?.email) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(formData?.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    if (!formData?.password) {
      newErrors.password = 'Password is required';
    } else if (!validatePassword(formData?.password)) {
      newErrors.password = 'Password does not meet all requirements';
    }
    if (!formData?.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData?.password !== formData?.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    if (!formData?.agreeTerms) {
      newErrors.agreeTerms = 'You must accept the terms of service';
    }
    return newErrors;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e?.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    // Clear field error on change
    if (errors?.[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
    setServerError('');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors)?.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setLoading(true);
    setServerError('');
    try {
      const { data, error } = await supabase?.auth?.signUp({
        email: formData?.email,
        password: formData?.password,
      });
      if (error) {
        setServerError(error?.message || 'Registration failed. Please try again.');
      } else {
        setSuccess(true);
        setTimeout(() => {
          navigate('/role-based-dashboard');
        }, 1500);
      }
    } catch (err) {
      setServerError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const passwordsMatch =
    formData?.confirmPassword?.length > 0 &&
    formData?.password === formData?.confirmPassword;

  const passwordMismatch =
    formData?.confirmPassword?.length > 0 &&
    formData?.password !== formData?.confirmPassword;

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* Server Error */}
      {serverError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <Icon name="AlertCircle" size={16} color="currentColor" />
          <span>{serverError}</span>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          <Icon name="CheckCircle" size={16} color="currentColor" />
          <span>Account created! Redirecting to dashboard...</span>
        </div>
      )}

      {/* Email */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Icon name="Mail" size={16} color="#94a3b8" />
          </div>
          <input
            type="email"
            name="email"
            value={formData?.email}
            onChange={handleChange}
            placeholder="you@example.com"
            className={`w-full pl-10 pr-10 py-2.5 bg-slate-700/50 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all text-sm ${
              errors?.email
                ? 'border-red-500/50 focus:ring-red-500/30'
                : formData?.email && !errors?.email && validateEmail(formData?.email)
                ? 'border-emerald-500/50 focus:ring-emerald-500/30' :'border-slate-600/50 focus:ring-blue-500/50 focus:border-blue-500/50'
            }`}
          />
          {formData?.email && !errors?.email && validateEmail(formData?.email) && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <Icon name="CheckCircle" size={16} color="#10b981" />
            </div>
          )}
        </div>
        {errors?.email && (
          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
            <Icon name="AlertCircle" size={12} color="currentColor" />
            {errors?.email}
          </p>
        )}
      </div>

      {/* Password */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Icon name="Lock" size={16} color="#94a3b8" />
          </div>
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={formData?.password}
            onChange={handleChange}
            placeholder="Create a strong password"
            className={`w-full pl-10 pr-10 py-2.5 bg-slate-700/50 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all text-sm ${
              errors?.password
                ? 'border-red-500/50 focus:ring-red-500/30' :'border-slate-600/50 focus:ring-blue-500/50 focus:border-blue-500/50'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} color="currentColor" />
          </button>
        </div>
        {errors?.password && (
          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
            <Icon name="AlertCircle" size={12} color="currentColor" />
            {errors?.password}
          </p>
        )}
        <PasswordStrengthMeter password={formData?.password} />
      </div>

      {/* Confirm Password */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm password</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Icon name="Lock" size={16} color="#94a3b8" />
          </div>
          <input
            type={showConfirmPassword ? 'text' : 'password'}
            name="confirmPassword"
            value={formData?.confirmPassword}
            onChange={handleChange}
            placeholder="Re-enter your password"
            className={`w-full pl-10 pr-10 py-2.5 bg-slate-700/50 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all text-sm ${
              errors?.confirmPassword || passwordMismatch
                ? 'border-red-500/50 focus:ring-red-500/30'
                : passwordsMatch
                ? 'border-emerald-500/50 focus:ring-emerald-500/30' :'border-slate-600/50 focus:ring-blue-500/50 focus:border-blue-500/50'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Icon name={showConfirmPassword ? 'EyeOff' : 'Eye'} size={16} color="currentColor" />
          </button>
        </div>
        {(errors?.confirmPassword || passwordMismatch) && (
          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
            <Icon name="AlertCircle" size={12} color="currentColor" />
            {errors?.confirmPassword || 'Passwords do not match'}
          </p>
        )}
        {passwordsMatch && !errors?.confirmPassword && (
          <p className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1">
            <Icon name="CheckCircle" size={12} color="currentColor" />
            Passwords match
          </p>
        )}
      </div>

      {/* Terms */}
      <div>
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative mt-0.5 flex-shrink-0">
            <input
              type="checkbox"
              name="agreeTerms"
              checked={formData?.agreeTerms}
              onChange={handleChange}
              className="sr-only"
            />
            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
              formData?.agreeTerms
                ? 'bg-blue-600 border-blue-600'
                : errors?.agreeTerms
                ? 'border-red-500/70 bg-slate-700/50' :'border-slate-500 bg-slate-700/50 group-hover:border-blue-400'
            }`}>
              {formData?.agreeTerms && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
          <span className="text-sm text-slate-400 leading-tight">
            I agree to the{' '}
            <button
              type="button"
              onClick={() => setShowTerms(true)}
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              Terms &amp; Privacy Policy
            </button>
          </span>
        </label>
        {errors?.agreeTerms && (
          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
            <Icon name="AlertCircle" size={12} color="currentColor" />
            {errors?.agreeTerms}
          </p>
        )}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || success}
        className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
      >
        {loading ? (
          <><Icon name="Loader2" size={16} color="white" /><span>Creating account...</span></>
        ) : success ? (
          <><Icon name="CheckCircle" size={16} color="white" /><span>Account created!</span></>
        ) : (
          <><Icon name="UserPlus" size={16} color="white" /><span>Create Account</span></>
        )}
      </button>
    </form>
    <TermsModal open={showTerms} onClose={() => setShowTerms(false)} />
    </>
  );
};

export default RegistrationForm;
