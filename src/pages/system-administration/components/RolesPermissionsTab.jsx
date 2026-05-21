import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { Checkbox } from '../../../components/ui/Checkbox';

const RolesPermissionsTab = () => {
  const [selectedRole, setSelectedRole] = useState('super_admin');
  const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false);

  const roles = [
    {
      id: 'super_admin',
      name: 'Super Administrator',
      description: 'Full system access with configuration control',
      userCount: 1,
      color: 'bg-error'
    },
    {
      id: 'admin',
      name: 'Administrator',
      description: 'Day-to-day system management and user setup',
      userCount: 3,
      color: 'bg-warning'
    },
    {
      id: 'director',
      name: 'Director',
      description: 'Read-only executive dashboards and strategic reports',
      userCount: 2,
      color: 'bg-primary'
    },
    {
      id: 'accountant',
      name: 'Accountant',
      description: 'Payment allocations and financial reporting',
      userCount: 4,
      color: 'bg-success'
    },
    {
      id: 'collections',
      name: 'Collections Officer',
      description: 'Overdue accounts and collection tracking',
      userCount: 5,
      color: 'bg-accent'
    },
    {
      id: 'sales',
      name: 'Sales Agent',
      description: 'Lead management and commission tracking',
      userCount: 12,
      color: 'bg-secondary'
    },
    {
      id: 'client',
      name: 'Client',
      description: 'Self-service access to assets and payments',
      userCount: 248,
      color: 'bg-muted-foreground'
    }
  ];

  const permissionModules = [
    {
      module: 'Dashboard',
      permissions: [
        { id: 'dashboard_view', label: 'View Dashboard', super_admin: true, admin: true, director: true, accountant: true, collections: true, sales: true, client: true },
        { id: 'dashboard_export', label: 'Export Dashboard Data', super_admin: true, admin: true, director: true, accountant: true, collections: false, sales: false, client: false }
      ]
    },
    {
      module: 'Asset Management',
      permissions: [
        { id: 'asset_view', label: 'View Assets', super_admin: true, admin: true, director: true, accountant: true, collections: true, sales: true, client: true },
        { id: 'asset_create', label: 'Create Assets', super_admin: true, admin: true, director: false, accountant: false, collections: false, sales: false, client: false },
        { id: 'asset_edit', label: 'Edit Assets', super_admin: true, admin: true, director: false, accountant: false, collections: false, sales: false, client: false },
        { id: 'asset_delete', label: 'Delete Assets', super_admin: true, admin: false, director: false, accountant: false, collections: false, sales: false, client: false }
      ]
    },
    {
      module: 'Client Management',
      permissions: [
        { id: 'client_view', label: 'View Clients', super_admin: true, admin: true, director: true, accountant: true, collections: true, sales: true, client: false },
        { id: 'client_create', label: 'Create Clients', super_admin: true, admin: true, director: false, accountant: false, collections: false, sales: true, client: false },
        { id: 'client_edit', label: 'Edit Clients', super_admin: true, admin: true, director: false, accountant: false, collections: true, sales: true, client: false },
        { id: 'client_delete', label: 'Delete Clients', super_admin: true, admin: false, director: false, accountant: false, collections: false, sales: false, client: false }
      ]
    },
    {
      module: 'Payment Processing',
      permissions: [
        { id: 'payment_view', label: 'View Payments', super_admin: true, admin: true, director: true, accountant: true, collections: true, sales: false, client: true },
        { id: 'payment_create', label: 'Process Payments', super_admin: true, admin: true, director: false, accountant: true, collections: true, sales: false, client: false },
        { id: 'payment_approve', label: 'Approve Payments', super_admin: true, admin: true, director: false, accountant: true, collections: false, sales: false, client: false },
        { id: 'payment_refund', label: 'Process Refunds', super_admin: true, admin: true, director: false, accountant: true, collections: false, sales: false, client: false }
      ]
    },
    {
      module: 'Reports & Analytics',
      permissions: [
        { id: 'report_view', label: 'View Reports', super_admin: true, admin: true, director: true, accountant: true, collections: true, sales: true, client: false },
        { id: 'report_export', label: 'Export Reports', super_admin: true, admin: true, director: true, accountant: true, collections: true, sales: false, client: false },
        { id: 'report_schedule', label: 'Schedule Reports', super_admin: true, admin: true, director: false, accountant: true, collections: false, sales: false, client: false }
      ]
    },
    {
      module: 'System Administration',
      permissions: [
        { id: 'admin_users', label: 'Manage Users', super_admin: true, admin: true, director: false, accountant: false, collections: false, sales: false, client: false },
        { id: 'admin_roles', label: 'Manage Roles', super_admin: true, admin: false, director: false, accountant: false, collections: false, sales: false, client: false },
        { id: 'admin_settings', label: 'System Settings', super_admin: true, admin: false, director: false, accountant: false, collections: false, sales: false, client: false },
        { id: 'admin_audit', label: 'View Audit Trail', super_admin: true, admin: true, director: true, accountant: false, collections: false, sales: false, client: false }
      ]
    }
  ];

  const currentRole = roles?.find(r => r?.id === selectedRole);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Roles & Permissions</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage user roles and their system access permissions</p>
        </div>
        
        <Button
          variant="default"
          iconName="Plus"
          iconPosition="left"
          onClick={() => setIsCreateRoleOpen(true)}
        >
          Create Custom Role
        </Button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
        <div className="lg:col-span-1 space-y-2">
          {roles?.map((role) => (
            <button
              key={role?.id}
              onClick={() => setSelectedRole(role?.id)}
              className={`w-full text-left p-4 rounded-lg border transition-smooth hover-lift press-scale ${
                selectedRole === role?.id
                  ? 'bg-primary bg-opacity-10 border-primary' :'bg-card border-border hover:border-primary'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg ${role?.color} bg-opacity-10 flex items-center justify-center flex-shrink-0`}>
                  <Icon name="Shield" size={20} color={`var(--color-${role?.id === 'super_admin' ? 'error' : role?.id === 'admin' ? 'warning' : 'primary'})`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground text-sm md:text-base truncate">{role?.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{role?.description}</p>
                  <p className="text-xs font-medium text-primary mt-2">{role?.userCount} user{role?.userCount !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 bg-card rounded-xl border border-border p-5 md:p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-semibold text-foreground">{currentRole?.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{currentRole?.description}</p>
            </div>
            <Button variant="outline" size="sm" iconName="Edit2">
              Edit Role
            </Button>
          </div>

          <div className="space-y-6">
            {permissionModules?.map((module) => (
              <div key={module.module} className="border-b border-border pb-6 last:border-b-0 last:pb-0">
                <h4 className="font-medium text-foreground mb-4 flex items-center gap-2">
                  <Icon name="Lock" size={16} color="var(--color-primary)" />
                  {module.module}
                </h4>
                <div className="space-y-3">
                  {module.permissions?.map((permission) => (
                    <div key={permission?.id} className="flex items-center justify-between p-3 rounded-md hover:bg-muted transition-smooth">
                      <span className="text-sm text-foreground">{permission?.label}</span>
                      <Checkbox
                        checked={permission?.[selectedRole]}
                        onChange={() => {}}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6 pt-6 border-t border-border">
            <Button variant="default" iconName="Save" fullWidth>
              Save Changes
            </Button>
            <Button variant="outline" fullWidth>
              Reset to Default
            </Button>
          </div>
        </div>
      </div>
      {isCreateRoleOpen && (
        <div className="fixed inset-0 bg-background bg-opacity-80 z-[200] flex items-center justify-center p-4">
          <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border p-5  flex items-center justify-between">
              <h2 className="text-2xl  font-semibold text-foreground">Create Custom Role</h2>
              <button onClick={() => setIsCreateRoleOpen(false)} className="p-1 hover:bg-muted rounded transition-smooth">
                <Icon name="X" size={20} color="var(--color-foreground)" />
              </button>
            </div>
            
            <div className="p-5  space-y-4">
              <Input label="Role Name" type="text" placeholder="Enter role name" required />
              <Input label="Role Description" type="text" placeholder="Describe the role's purpose" required />
              
              <div className="space-y-4 pt-4">
                <h3 className="font-medium text-foreground">Select Permissions</h3>
                {permissionModules?.slice(0, 3)?.map((module) => (
                  <div key={module.module} className="border border-border rounded-xl p-4">
                    <h4 className="font-medium text-foreground mb-3">{module.module}</h4>
                    <div className="space-y-2">
                      {module.permissions?.map((permission) => (
                        <Checkbox key={permission?.id} label={permission?.label} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button variant="default" iconName="Plus" fullWidth>
                  Create Role
                </Button>
                <Button variant="outline" onClick={() => setIsCreateRoleOpen(false)} fullWidth>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RolesPermissionsTab;