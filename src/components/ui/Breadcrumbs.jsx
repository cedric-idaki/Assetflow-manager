import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';
import { formatKEPhone } from '../../utils/phoneUtils';

const Breadcrumbs = () => {
  const location = useLocation();
  const pathnames = location?.pathname?.split('/')?.filter((x) => x);

  const breadcrumbMap = {
    'role-based-dashboard': 'Dashboard',
    'asset-client-management': 'Assets & Clients',
    'payment-collections-hub': 'Payments & Collections',
    'sales-agent-portal': 'Sales Portal',
    'reports-analytics-center': 'Reports & Analytics',
    'system-administration': 'Administration',
  };

  const getBreadcrumbLabel = (path) => {
    return breadcrumbMap?.[path] || path?.replace(/-/g, ' ')?.replace(/\b\w/g, (l) => l?.toUpperCase());
  };

  if (pathnames?.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex items-center space-x-2 text-sm">
        <li>
          <Link
            to="/"
            className="flex items-center text-muted-foreground hover:text-foreground transition-smooth"
          >
            <Icon name="Home" size={16} color="currentColor" />
          </Link>
        </li>
        {pathnames?.map((path, index) => {
          const routeTo = `/${pathnames?.slice(0, index + 1)?.join('/')}`;
          const isLast = index === pathnames?.length - 1;

          return (
            <li key={path} className="flex items-center space-x-2">
              <Icon name="ChevronRight" size={16} color="var(--color-muted-foreground)" />
              {isLast ? (
                <span className="font-medium text-foreground">{getBreadcrumbLabel(path)}</span>
              ) : (
                <Link
                  to={routeTo}
                  className="text-muted-foreground hover:text-foreground transition-smooth"
                >
                  {getBreadcrumbLabel(path)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumbs;