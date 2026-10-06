import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { FiBarChart2, FiCreditCard, FiFileText, FiHome, FiLogOut, FiMenu, FiMessageCircle, FiSettings, FiShield, FiUser, FiX } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import Logo from './Logo';

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: FiHome }, { to: '/chat', label: 'Legal assistant', icon: FiMessageCircle },
  { to: '/documents', label: 'Documents', icon: FiFileText }, { to: '/subscription', label: 'Plans & access', icon: FiCreditCard }, { to: '/profile', label: 'Account', icon: FiUser },
];
const initials = (user) => `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';
export default function AppShell({ children, title, eyebrow, action, wide = false }) {
  const [isOpen, setIsOpen] = useState(false); const { user, logout } = useAuth(); const navigate = useNavigate(); const close = () => setIsOpen(false);
  const leave = async () => { await logout(); navigate('/'); };
  return <div className="app-shell">
    <button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setIsOpen(true)}><FiMenu /></button>
    {isOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={close} />}
    <aside className={`app-sidebar ${isOpen ? 'is-open' : ''}`}>
      <div className="sidebar-top"><Link to="/dashboard" onClick={close}><Logo /></Link><button className="sidebar-close" onClick={close}><FiX /></button></div>
      <nav className="sidebar-nav">{navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={close} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><Icon /><span>{label}</span></NavLink>)}{user?.isAdmin && <NavLink to="/admin" onClick={close} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><FiShield /><span>Admin</span></NavLink>}</nav>
      <div className="sidebar-bottom"><Link to="/subscription" className="tier-card" onClick={close}><span className="tier-shine" /><small>YOUR ACCESS</small><strong>{user?.subscriptionStatus || user?.userTier || 'Free'} plan</strong><span>Manage plan <FiBarChart2 /></span></Link>
        <Link to="/profile" className="user-menu" onClick={close}><span className="avatar">{user?.profileImage ? <img src={user.profileImage} alt="" /> : initials(user)}</span><span><strong>{[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Your account'}</strong><small>{user?.email}</small></span><FiSettings /></Link>
        <button className="sidebar-link signout" onClick={leave}><FiLogOut /><span>Sign out</span></button></div>
    </aside>
    <div className="app-main"><header className="app-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}{title && <h1>{title}</h1>}</div>{action && <div className="header-action">{action}</div>}</header><main className={`page-content ${wide ? 'page-wide' : ''}`}>{children}</main></div>
  </div>;
}
