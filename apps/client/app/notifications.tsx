'use client';
import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import type { Notification } from '../lib/marketplace';
export default function Notifications({ userId, onChange }: {
    userId: string;
    onChange?: () => Promise<void>;
}) {
    const [items, setItems] = useState<Notification[]>([]), [expanded, setExpanded] = useState(false), [error, setError] = useState(''), [toast, setToast] = useState('');
    const callback = useRef(onChange);
    callback.current = onChange;
    useEffect(() => { let live = true, running = false; const seen = new Set<string>(); async function poll() { if (running)
        return; running = true; try {
        const data = await request<{
            notifications: Notification[];
        }>('/me/notifications');
        if (!live)
            return;
        setItems(data.notifications);
        setError('');
        const completed = data.notifications.some(n => n.kind === 'trade_completed' && !seen.has(n.id));
        const latest = data.notifications.find(n => n.kind === 'trade_completed' && !n.read_at && !seen.has(n.id));
        if (latest)
            setToast(latest.message);
        if (completed)
            await callback.current?.();
        data.notifications.forEach(n => seen.add(n.id));
    }
    catch {
        if (live)
            setError('Notifications temporarily unavailable.');
    }
    finally {
        running = false;
    } } poll(); const timer = setInterval(poll, 8000); return () => { live = false; clearInterval(timer); }; }, [userId]);
    const unread = items.filter(n => !n.read_at).length;
    return <div className="notification-center">{toast && <div className="notification-toast" role="status"><p>{toast}</p><button onClick={() => setToast('')}>Dismiss</button></div>}<button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>Notifications {unread > 0 && <b className="notification-badge">{unread}</b>}</button><span className="sr-only" role="status">{unread} unread notifications</span>{expanded && <section className="notification-popover panel" aria-label="Notifications"><h3>Activity</h3>{error && <p role="alert">{error}</p>}{!items.length && <p>No activity yet.</p>}{items.map(n => <article key={n.id} className={!n.read_at ? 'unread' : ''}><p>{n.message}</p><small>{new Date(n.created_at).toLocaleString()}</small>{!n.read_at && <button onClick={async () => { try {
        await request(`/me/notifications/${n.id}/read`, {});
        setItems(v => v.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
    }
    catch {
        setError('Could not mark notification read.');
    } }}>Mark read</button>}</article>)}</section>}</div>;
}
