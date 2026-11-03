import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';
const icons = {
  DONOR_OPPORTUNITY: '🩸', DONOR_ACCEPTED: '✓', DONOR_DECLINED: '↗', DONOR_WITHDREW: '↩', REQUEST_STATUS: '⚑',
  ORGANIZATION_SUBMITTED: '▣', ORGANIZATION_APPROVED: '✓', ORGANIZATION_REJECTED: '!', ORGANIZATION_SUSPENDED: '⏸',
};

export function NotificationBell({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/notifications?limit=5`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not load notifications.');
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function openItem(item) {
    try {
      const response = await fetch(`${API}/notifications/${item.id}/open`, { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Referenced page is unavailable.');
      if (!item.readAt) await fetch(`${API}/notifications/${item.id}/read`, { method: 'PATCH', credentials: 'include' });
      await load();
      setOpen(false);
      onNavigate(data.destination);
    } catch (reason) { setError(reason.message); }
  }

  return <div className="relative">
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) load(); }} className="relative rounded-xl border border-slate-300 bg-white p-2.5 text-lg shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
      <span aria-hidden="true">🔔</span>{unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-700 px-1 text-center text-[10px] font-bold leading-5 text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <section role="dialog" aria-label="Recent notifications" className="absolute right-0 z-30 mt-3 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800"><div><h2 className="font-bold">Notifications</h2><p className="text-xs text-slate-500">{unreadCount} unread</p></div><button onClick={() => { setOpen(false); onNavigate({ view: 'notifications' }); }} className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300">View all</button></header>
      {error && <p role="alert" className="p-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {loading && items.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Loading…</p> : items.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">You’re all caught up.</p> : <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">{items.map((item) => <li key={item.id}><button onClick={() => openItem(item)} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800 ${item.readAt ? 'opacity-75' : ''}`}><span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200" aria-hidden="true">{icons[item.type] || '•'}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-semibold"><span className="truncate">{item.title}</span>{!item.readAt && <i className="size-2 shrink-0 rounded-full bg-rose-600" aria-label="Unread" />}</span><span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{item.message}</span><time className="mt-1 block text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString()}</time></span></button></li>)}</ul>}
    </section>}
  </div>;
}

export default function NotificationsPage({ onNavigate }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load(nextPage = page) {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/notifications?page=${nextPage}&limit=20`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not load notifications.');
      setItems(data.notifications); setPagination(data.pagination); setUnreadCount(data.unreadCount);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(page); }, [page]);

  async function markAllRead() {
    const response = await fetch(`${API}/notifications/read-all`, { method: 'PATCH', credentials: 'include' });
    if (!response.ok) { setError('Could not mark notifications as read.'); return; }
    setMessage('All notifications marked as read.'); await load(page);
  }

  async function openItem(item) {
    setError('');
    try {
      const response = await fetch(`${API}/notifications/${item.id}/open`, { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Referenced page is unavailable.');
      if (!item.readAt) await fetch(`${API}/notifications/${item.id}/read`, { method: 'PATCH', credentials: 'include' });
      onNavigate(data.destination);
    } catch (reason) { setError(reason.message); }
  }

  return <section className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">Your updates</p><h2 className="mt-2 text-2xl font-bold">Notifications</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{unreadCount} unread notifications</p></div><button onClick={markAllRead} disabled={unreadCount === 0 || loading} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700">Mark all as read</button></header>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
    {loading && items.length === 0 ? <p className="rounded-2xl bg-white p-8 text-center text-slate-500 shadow-sm dark:bg-slate-900">Loading notifications…</p> : items.length === 0 ? <div className="rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-slate-900"><h3 className="font-bold">No notifications yet</h3><p className="mt-2 text-sm text-slate-500">Important request and organization updates will appear here.</p></div> : <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">{items.map((item) => <li key={item.id}><button onClick={() => openItem(item)} className="flex w-full gap-4 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800 sm:p-5"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-teal-50 text-lg text-teal-800 dark:bg-teal-950 dark:text-teal-200" aria-hidden="true">{icons[item.type] || '•'}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="text-sm">{item.title}</strong>{!item.readAt && <i className="size-2 rounded-full bg-rose-600" aria-label="Unread" />}</span><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{item.message}</span><time className="mt-2 block text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</time></span></button></li>)}</ul>}
    <div className="flex items-center justify-center gap-3"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40 dark:border-slate-700">Previous</button><span className="text-sm text-slate-500">Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span><button disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40 dark:border-slate-700">Next</button></div>
  </section>;
}
