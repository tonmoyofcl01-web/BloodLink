import { useCallback, useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';
const statusColors = {
  NOTIFIED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  ACCEPTED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  DECLINED: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  WITHDRAWN: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  INVALIDATED: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  CLOSED: 'bg-slate-900 text-white dark:bg-slate-700',
};

export default function MyOpportunities() {
  const [opportunities, setOpportunities] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (nextPage = page) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/donors/me/opportunities?page=${nextPage}&limit=20`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not load opportunities.');
      setOpportunities(data.opportunities);
      setPagination(data.pagination);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(page); }, [page, load]);

  async function respond(opportunity, action) {
    setSavingId(opportunity.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API}/donors/me/opportunities/${opportunity.id}/respond`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not update your response.');
      setMessage(action === 'ACCEPT' ? 'Opportunity accepted.' : action === 'DECLINE' ? 'Opportunity declined.' : 'Your acceptance was withdrawn.');
      setConfirmAction(null);
      await load(page);
    } catch (reason) { setError(reason.message); }
    finally { setSavingId(null); }
  }

  return <section className="space-y-6">
    <header><p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">Donor workspace</p><h2 className="mt-2 text-2xl font-bold">My Opportunities</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Only opportunities belonging to your donor profile appear here.</p></header>
    <p className="rounded-xl border-l-4 border-rose-600 bg-rose-50 p-4 text-sm leading-6 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">These are potential opportunities, not medical approval. Qualified medical professionals must verify donor suitability and blood compatibility.</p>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-100 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    {loading && opportunities.length === 0 ? <p className="rounded-2xl bg-white p-8 text-center text-slate-500 shadow-sm dark:bg-slate-900">Loading opportunities…</p> : opportunities.length === 0 ? <div className="rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-slate-900"><h3 className="font-bold">No opportunities yet</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">New opportunities appear here when an open request matches your opted-in donor profile.</p></div> : <>
      <ul className="grid gap-4 md:grid-cols-2">
        {opportunities.map((opportunity) => {
          const requestOpen = opportunity.requestStatus === 'OPEN' && new Date(opportunity.neededAt) > new Date();
          const canRespond = opportunity.status === 'NOTIFIED' && requestOpen;
          const canWithdraw = opportunity.status === 'ACCEPTED' && requestOpen;
          return <li key={opportunity.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900 dark:ring-slate-800 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{opportunity.urgency} request</p><h3 className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-300">{opportunity.bloodGroup} · {opportunity.unitsRequested} units</h3></div><StatusBadge status={opportunity.status} /></div>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><Detail label="Coarse location" value={`${opportunity.location.district}, ${opportunity.location.division}`} /><Detail label="Needed by" value={new Date(opportunity.neededAt).toLocaleString()} /></dl>
            {!requestOpen && opportunity.status === 'NOTIFIED' && <p className="mt-4 text-sm text-slate-500">This opportunity is no longer open for responses.</p>}
            {(canRespond || canWithdraw) && (confirmAction?.id === opportunity.id ? <div className="mt-5 rounded-xl bg-slate-100 p-4 dark:bg-slate-800"><p className="text-sm font-semibold">Confirm {confirmAction.action.toLowerCase()}?</p><div className="mt-3 flex gap-2"><button disabled={savingId === opportunity.id} onClick={() => respond(opportunity, confirmAction.action)} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingId === opportunity.id ? 'Saving…' : 'Confirm'}</button><button onClick={() => setConfirmAction(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Keep current response</button></div></div> : <div className="mt-5 flex flex-wrap gap-2">
              {canRespond && <><button disabled={savingId === opportunity.id} onClick={() => setConfirmAction({ id: opportunity.id, action: 'ACCEPT' })} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">Accept</button><button disabled={savingId === opportunity.id} onClick={() => setConfirmAction({ id: opportunity.id, action: 'DECLINE' })} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Decline</button></>}
              {canWithdraw && <button disabled={savingId === opportunity.id} onClick={() => setConfirmAction({ id: opportunity.id, action: 'WITHDRAW' })} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:text-rose-300">Withdraw acceptance</button>}
            </div>)}
            <p className="mt-4 text-xs text-slate-500">Contact details and precise donor location are not shared here.</p>
          </li>;
        })}
      </ul>
      <div className="flex items-center justify-center gap-3"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40 dark:border-slate-700">Previous</button><span className="text-sm text-slate-500">Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span><button disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40 dark:border-slate-700">Next</button></div>
    </>}
  </section>;
}

function StatusBadge({ status }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusColors[status] || statusColors.CLOSED}`}>{status.replaceAll('_', ' ')}</span>;
}

function Detail({ label, value }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
}
