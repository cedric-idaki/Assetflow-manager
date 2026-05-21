export const ACTION_TYPE_CONFIG = {
  payment_split_change: { icon: 'GitBranch', color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Payment Split Change' },
  debt_adjustment: { icon: 'TrendingDown', color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Debt Adjustment' },
  commission_override: { icon: 'DollarSign', color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Commission Override' },
  role_change: { icon: 'Shield', color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Role Change' },
  high_value_transaction: { icon: 'AlertTriangle', color: 'text-red-500', bg: 'bg-red-500/10', label: 'High Value Transaction' },
  kyc_approval: { icon: 'UserCheck', color: 'text-green-500', bg: 'bg-green-500/10', label: 'KYC Approval' },
  user_creation: { icon: 'UserPlus', color: 'text-teal-500', bg: 'bg-teal-500/10', label: 'User Creation' },
  asset_deletion: { icon: 'Trash2', color: 'text-red-600', bg: 'bg-red-600/10', label: 'Asset Deletion' },
  payment_refund: { icon: 'RotateCcw', color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Payment Refund' },
  system_config: { icon: 'Settings', color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'System Config' },
};

export const PRIORITY_CONFIG = {
  critical: { label: 'Critical', class: 'bg-red-500/10 text-red-500 border border-red-500/20' },
  high: { label: 'High', class: 'bg-orange-500/10 text-orange-500 border border-orange-500/20' },
  medium: { label: 'Medium', class: 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20' },
  low: { label: 'Low', class: 'bg-muted text-muted-foreground border border-border' },
};

export const STATUS_CONFIG = {
  pending: { label: 'Pending', class: 'bg-yellow-500/10 text-yellow-600', icon: 'Clock' },
  approved: { label: 'Approved', class: 'bg-green-500/10 text-green-600', icon: 'CheckCircle' },
  rejected: { label: 'Rejected', class: 'bg-red-500/10 text-red-500', icon: 'XCircle' },
  escalated: { label: 'Escalated', class: 'bg-orange-500/10 text-orange-500', icon: 'ArrowUpCircle' },
  expired: { label: 'Expired', class: 'bg-muted text-muted-foreground', icon: 'Clock' },
};