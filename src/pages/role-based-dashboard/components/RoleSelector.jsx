import React from 'react';
import Select from '../../../components/ui/Select';

const RoleSelector = ({ currentRole, onRoleChange }) => {
  const roleOptions = [
    { value: 'super_admin', label: 'Super Administrator' },
    { value: 'admin', label: 'Administrator' },
    { value: 'director', label: 'Director' },
    { value: 'accountant', label: 'Accountant' },
    { value: 'collections', label: 'Collections Officer' },
    { value: 'sales', label: 'Sales Agent' },
    { value: 'client', label: 'Client' },
  ];

  return (
    <div className="mb-6">
      <Select
        label="View Dashboard As"
        description="Switch between different role perspectives"
        options={roleOptions}
        value={currentRole}
        onChange={onRoleChange}
        className="max-w-xs"
      />
    </div>
  );
};

export default RoleSelector;