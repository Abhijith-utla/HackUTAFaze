'use client';
import { useEffect, useRef, useState } from 'react';

/** Avatar button + dropdown: who you are, admin entry (switch for admins, staff sign-in for everyone else), sign out. */
export default function ProfileMenu({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return <div className="profile-menu" ref={root}>
    <button type="button" className="profile-icon" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${name}`} onClick={() => setOpen(o => !o)}>{initial}</button>
    {open && <div className="profile-dropdown" role="menu">
      <div className="profile-who"><strong>{name}</strong><span>{role === 'admin' ? 'Admin' : 'Collector'}</span></div>
      <a role="menuitem" href="/admin/control">{role === 'admin' ? 'Switch to admin mode' : 'Admin sign in'}</a>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>
    </div>}
  </div>;
}
