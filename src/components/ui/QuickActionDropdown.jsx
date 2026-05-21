import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';
import Button from './Button';
import { formatKEPhone } from '../../utils/phoneUtils';

const QuickActionDropdown = ({ userRole = 'admin' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Each action navigates to the correct page for that task
  const quickActions = [
    {
      label: 'Add Payment',
      icon: 'CreditCard',
      roles: ['admin', 'manager', 'finance', 'collections_officer', 'accountant'],
      action: () => navigate('/payment-collections-hub'),
    },
    {
      label: 'Register Asset',
      icon: 'Package',
      roles: ['admin', 'manager', 'operations'],
      action: () => navigate('/asset-client-management'),
    },
    {
      label: 'Create Client',
      icon: 'UserPlus',
      roles: ['admin', 'manager', 'operations', 'sales_agent', 'sales'],
      action: () => navigate('/asset-client-management'),
    },
    {
      label: 'KYC Management',
      icon: 'ShieldCheck',
      roles: ['admin', 'manager', 'director', 'accountant', 'collections_officer'],
      action: () => navigate('/kyc-management-screen'),
    },
    {
      label: 'View Reports',
      icon: 'BarChart3',
      roles: ['admin', 'manager', 'finance', 'director', 'accountant'],
      action: () => navigate('/reports-analytics-center'),
    },
    {
      label: 'Register Lead',
      icon: 'Target',
      roles: ['sales_agent', 'sales'],
      action: () => navigate('/sales-agent-portal'),
    },
  ];

  const availableActions = quickActions.filter(
    (a) => a.roles.includes(userRole) || a.roles.includes('all')
  );

  const handleActionClick = (action) => {
    action.action();
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    const handleEscape = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  if (availableActions.length === 0) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button variant="default" iconName="Zap" iconPosition="left" onClick={() => setIsOpen(!isOpen)} className="shadow-sm">
        Quick Actions
      </Button>
      {isOpen && (
        <div className="absolute right-0 mt-2 w-52 bg-popover border border-border rounded-xl shadow-lg z-50 py-1.5"
          style={{ animation: 'fadeIn 150ms ease' }}>
          <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Quick Actions
          </div>
          {availableActions.map((action, i) => (
            <button
              key={i}
              onClick={() => handleActionClick(action)}
              className="flex items-center w-full px-3 py-2.5 text-sm text-popover-foreground hover:bg-muted transition-colors gap-3"
            >
              <Icon name={action.icon} size={15} color="var(--color-primary)" />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
};

export default QuickActionDropdown;
