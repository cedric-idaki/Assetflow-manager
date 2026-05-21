import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/ui/Sidebar';
import Header from '../components/ui/Header';
import Breadcrumbs from '../components/ui/Breadcrumbs';

const MainLayout = function(props) {
  var children = props.children;
  var location = useLocation();

  var collapsedState = useState(false);
  var isSidebarCollapsed = collapsedState[0];
  var setIsSidebarCollapsed = collapsedState[1];

  var darkState = useState(false);
  var isDarkMode = darkState[0];
  var setIsDarkMode = darkState[1];

  var mobileState = useState(false);
  var isMobileOpen = mobileState[0];
  var setIsMobileOpen = mobileState[1];

  // Close mobile sidebar on route change
  useEffect(function() {
    setIsMobileOpen(false);
  }, [location.pathname]);

  // Close mobile sidebar on desktop resize
  useEffect(function() {
    var handleResize = function() {
      if (window.innerWidth >= 1024) {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return function() { window.removeEventListener('resize', handleResize); };
  }, []);

  var handleToggleSidebar = function() {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  var handleToggleTheme = function() {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  var desktopMargin = isSidebarCollapsed ? '70px' : '240px';

  return (
    <div className="min-h-screen bg-background">

      {/* Mobile dark overlay — tap to close sidebar */}
      {isMobileOpen && (
        <div
          onClick={function() { setIsMobileOpen(false); }}
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* Sidebar — fixed on both mobile and desktop */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        isMobileOpen={isMobileOpen}
        onMobileClose={function() { setIsMobileOpen(false); }}
      />

      {/* Main area */}
      <div
        className="min-h-screen transition-all duration-300"
        style={{ marginLeft: 0 }}
      >
        {/* Mobile layout — no left margin */}
        <div className="lg:hidden flex flex-col min-h-screen">
          <Header
            onThemeToggle={handleToggleTheme}
            isDarkMode={isDarkMode}
            onMobileMenuToggle={function() { setIsMobileOpen(!isMobileOpen); }}
            isMobileMenuOpen={isMobileOpen}
          />
          <main className="pt-20 px-3 sm:px-4 pb-8 overflow-x-hidden">
            <Breadcrumbs />
            {children || <Outlet />}
          </main>
        </div>

        {/* Desktop layout — left margin = sidebar width */}
        <div
          className="hidden lg:flex lg:flex-col min-h-screen transition-all duration-300"
          style={{ marginLeft: desktopMargin }}
        >
          <Header
            onThemeToggle={handleToggleTheme}
            isDarkMode={isDarkMode}
            onMobileMenuToggle={function() { setIsMobileOpen(!isMobileOpen); }}
            isMobileMenuOpen={isMobileOpen}
          />
          <main className="pt-20 px-5 pb-8 overflow-x-hidden">
            <Breadcrumbs />
            {children || <Outlet />}
          </main>
        </div>
      </div>
    </div>
  );
};

export default MainLayout;
