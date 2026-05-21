import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import RegistrationForm from './components/RegistrationForm';

const UserRegistrationScreen = () => {
  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div
        className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #0A1628 0%, #1B3A6B 50%, #0D2040 100%)' }}
      >
        {/* Gold top border accent */}
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #C9A84C, #D4AF37, #C9A84C)' }} />

        {/* Background pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 right-20 w-64 h-64 rounded-full border-2 border-white" />
          <div className="absolute top-32 right-32 w-40 h-40 rounded-full border border-white" />
          <div className="absolute bottom-40 left-10 w-48 h-48 rounded-full border border-white" />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-12 h-12 rounded-lg"
              style={{ background: 'linear-gradient(135deg, #C9A84C, #D4AF37)' }}
            >
              <Icon name="Building2" size={24} color="#0A1628" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Merriweather, serif' }}>AssetFlow</h1>
              <p className="text-xs" style={{ color: '#C9A84C' }}>Financial Management Platform</p>
            </div>
          </div>
        </div>

        {/* Center content */}
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <div className="w-12 h-0.5 mb-6" style={{ background: '#C9A84C' }} />
          <h2 className="text-3xl font-bold text-white leading-tight mb-4" style={{ fontFamily: 'Merriweather, serif' }}>
            Join AssetFlow Today
          </h2>
          <p className="text-sm leading-relaxed mb-8" style={{ color: '#A8BDD4' }}>
            Create your account to access the full suite of financial management tools designed for your business.
          </p>
          <div className="space-y-3">
            {[
              { icon: 'CheckCircle', text: 'Secure role-based access control' },
              { icon: 'CheckCircle', text: 'Real-time data and notifications' },
              { icon: 'CheckCircle', text: 'Comprehensive audit trail' },
            ]?.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <Icon name={item?.icon} size={16} color="#C9A84C" />
                <span className="text-sm" style={{ color: '#A8BDD4' }}>{item?.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-xs" style={{ color: '#5A7A9A' }}>© {new Date()?.getFullYear()} AssetFlow. All rights reserved.</p>
        </div>
      </div>

      {/* Right Panel - Registration Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 overflow-y-auto bg-white">
        {/* Mobile logo */}
        <div className="lg:hidden mb-6 text-center">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-lg mb-3"
            style={{ background: 'linear-gradient(135deg, #1B3A6B, #2C5282)' }}
          >
            <Icon name="Building2" size={26} color="white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: '#0A1628', fontFamily: 'Merriweather, serif' }}>AssetFlow</h1>
        </div>

        <div className="w-full max-w-md">
          {/* Form header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold mb-1" style={{ color: '#0A1628', fontFamily: 'Merriweather, serif' }}>Create Account</h2>
            <p className="text-sm" style={{ color: '#5A6A85' }}>Fill in your details to get started</p>
            <div className="mt-3 w-10 h-0.5" style={{ background: '#C9A84C' }} />
          </div>

          <RegistrationForm />

          <div className="mt-6 pt-5 text-center" style={{ borderTop: '1px solid #E2E8F0' }}>
            <p className="text-sm" style={{ color: '#5A6A85' }}>
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-semibold hover:underline"
                style={{ color: '#C9A84C' }}
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserRegistrationScreen;
