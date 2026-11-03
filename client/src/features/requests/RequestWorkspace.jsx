import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || '/api/v1';
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const STATUSES = ['OPEN', 'PAUSED', 'CANCELLED', 'CLOSED', 'EXPIRED', 'FULFILLED'];

const emptyRequest = () => ({ bloodGroup: 'O+', unitsRequested: '1', division: '', district: '', area: '', urgency: 'URGENT', neededAt: toLocalDateTime(new Date(Date.now() + 60 * 60 * 1000)), facilityName: '', publicNote: '' });

function toLocalDateTime(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

export default function RequestWorkspace({ focusRequestId }) {
  const [section, setSection] = useState('mine');
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function loadRequests() {
    setLoading(true);
    setMessage('');
    try {
      const query = new URLSearchParams({ page: String(page), limit: '10' });
      if (statusFilter !== 'ALL') query.set('status', statusFilter);
      const response = await fetch(`${API}/requests/mine?${query}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not load requests.');
      setRequests(data.requests);
      setPagination(data.pagination);
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadRequests(); }, [page, statusFilter]);

  async function openDetails(id) {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API}/requests/${id}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not load request details.');
      setSelected(data.request);
      setEditing(false);
      setSection('mine');
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (focusRequestId) openDetails(focusRequestId); }, [focusRequestId]);

  async function saveRequest(event, initial) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    body.unitsRequested = Number(body.unitsRequested);
    body.neededAt = new Date(body.neededAt).toISOString();
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(initial ? `${API}/requests/${initial.id}` : `${API}/requests`, {
        method: initial ? 'PUT' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not save request.');
      setSelected(data.request);
      setEditing(false);
      setSection('mine');
      await loadRequests();
      setMessage(initial ? 'Request updated.' : 'Emergency blood request created.');
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  async function changeStatus(status) {
    if (!selected) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API}/requests/${selected.id}/status`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not update request status.');
      setSelected(data.request);
      await loadRequests();
      setMessage(`Request status changed to ${status.toLowerCase()}.`);
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  const canManage = selected && ['OPEN', 'PAUSED'].includes(selected.status);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">Emergency network</p>
          <h2 className="mt-2 text-2xl font-bold">Blood requests</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Create and manage your requests. Request details are private to your account.</p>
        </div>
        <div className="flex gap-2 rounded-xl bg-slate-200 p-1 dark:bg-slate-800">
          <button onClick={() => { setSection('mine'); setEditing(false); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${section === 'mine' ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300'}`}>My requests</button>
          <button onClick={() => { setSection('create'); setSelected(null); setEditing(false); setMessage(''); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${section === 'create' ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300'}`}>Create request</button>
        </div>
      </div>

      {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{message}</p>}

      {section === 'create' || editing ? <RequestForm initial={editing ? selected : null} saving={loading} onSubmit={saveRequest} onCancel={() => { setEditing(false); setSection('mine'); }} /> : (
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold">My Blood Requests <span className="text-sm font-normal text-slate-500">({pagination.total})</span></h3>
              <select aria-label="Filter requests by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="ALL">All statuses</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
            {loading && requests.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">Loading requests…</p> : requests.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No requests found. Create a request when you need help.</p> : (
              <ul className="mt-4 space-y-3">
                {requests.map((request) => <li key={request.id}>
                  <button onClick={() => openDetails(request.id)} className={`w-full rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${selected?.id === request.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30' : 'border-slate-200 dark:border-slate-800'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="font-bold text-rose-700 dark:text-rose-300">{request.bloodGroup} · {request.unitsRequested} units</span><StatusBadge status={request.status} /></div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{request.area}, {request.district}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(request.neededAt).toLocaleString()} · {request.urgency}</p>
                  </button>
                </li>)}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-between text-sm">
              <button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40 dark:border-slate-700">Previous</button>
              <span className="text-slate-500">Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span>
              <button disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40 dark:border-slate-700">Next</button>
            </div>
          </section>

          <section className="min-h-64 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:p-8">
            {!selected ? <div className="flex h-full min-h-48 items-center justify-center text-center text-sm text-slate-500">Select a request to view its details and status.</div> : <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-sm font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">{selected.urgency} request</p><h3 className="mt-1 text-2xl font-bold">{selected.bloodGroup} · {selected.unitsRequested} units</h3></div>
                <StatusBadge status={selected.status} />
              </div>
              <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
                <Detail label="Required by" value={new Date(selected.neededAt).toLocaleString()} />
                <Detail label="Location" value={`${selected.area}, ${selected.district}, ${selected.division}`} />
                <Detail label="Facility" value={selected.facilityName || 'Not specified'} />
                <Detail label="Public note" value={selected.publicNote || 'None'} />
              </dl>
              <p className="mt-6 rounded-xl border-l-4 border-rose-600 bg-rose-50 p-4 text-sm leading-6 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">Donor discovery identifies potential candidates only. Qualified medical professionals must verify donor suitability and blood compatibility.</p>
              <RequestMatches key={`${selected.id}-${selected.updatedAt}`} request={selected} />
              {canManage && <div className="mt-6 flex flex-wrap gap-2">
                <button onClick={() => { setEditing(true); setSection('mine'); }} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-teal-700">Edit request</button>
                {selected.status === 'OPEN' ? <button onClick={() => changeStatus('PAUSED')} disabled={loading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Pause</button> : <button onClick={() => changeStatus('OPEN')} disabled={loading} className="rounded-lg border border-teal-300 px-4 py-2 text-sm font-semibold text-teal-800 dark:border-teal-800 dark:text-teal-200">Reopen</button>}
                <button onClick={() => changeStatus('CANCELLED')} disabled={loading} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:text-rose-300">Cancel</button>
                <button onClick={() => changeStatus('CLOSED')} disabled={loading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Close</button>
              </div>}
              <p className="mt-5 text-xs text-slate-500">Created {new Date(selected.createdAt).toLocaleString()}{selected.closedAt ? ` · Closed ${new Date(selected.closedAt).toLocaleString()}` : ''}</p>
            </>}
          </section>
        </div>
      )}
    </section>
  );
}

function RequestForm({ initial, saving, onSubmit, onCancel }) {
  const [error, setError] = useState('');
  const neededAt = initial ? toLocalDateTime(new Date(initial.neededAt)) : emptyRequest().neededAt;
  return <form onSubmit={(event) => { setError(''); onSubmit(event, initial).catch((reason) => setError(reason.message)); }} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:p-8">
    <h3 className="text-xl font-bold">{initial ? 'Edit blood request' : 'Create Blood Request'}</h3>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Enter the required details. A healthcare professional must confirm medical suitability and compatibility.</p>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">Blood group<select name="bloodGroup" defaultValue={initial?.bloodGroup || 'O+'} className={inputClass}>{GROUPS.map((group) => <option key={group}>{group}</option>)}</select></label>
      <label className="block text-sm font-medium">Units required<input name="unitsRequested" type="number" min="1" max="1000" defaultValue={initial?.unitsRequested || 1} required className={inputClass} /></label>
      <label className="block text-sm font-medium">Urgency<select name="urgency" defaultValue={initial?.urgency || 'URGENT'} className={inputClass}><option value="URGENT">Urgent</option><option value="SCHEDULED">Scheduled</option></select></label>
      <label className="block text-sm font-medium">Required date and time<input name="neededAt" type="datetime-local" defaultValue={neededAt} required className={inputClass} /></label>
      <label className="block text-sm font-medium">Division<input name="division" defaultValue={initial?.division || ''} maxLength="80" required className={inputClass} /></label>
      <label className="block text-sm font-medium">District<input name="district" defaultValue={initial?.district || ''} maxLength="80" required className={inputClass} /></label>
      <label className="block text-sm font-medium">Area or locality<input name="area" defaultValue={initial?.area || ''} maxLength="100" required className={inputClass} /></label>
      <label className="block text-sm font-medium">Hospital or facility (optional)<input name="facilityName" defaultValue={initial?.facilityName || ''} maxLength="180" className={inputClass} /></label>
      <label className="block text-sm font-medium sm:col-span-2">Short public note (optional)<textarea name="publicNote" defaultValue={initial?.publicNote || ''} maxLength="500" rows="3" className={inputClass} /><span className="mt-1 block text-xs text-slate-500">Do not include donor contact details or sensitive personal information.</span></label>
    </div>
    {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
    <div className="mt-6 flex gap-3"><button disabled={saving} className="rounded-xl bg-rose-700 px-5 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-50">{saving ? 'Saving…' : initial ? 'Save changes' : 'Create request'}</button><button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 px-5 py-3 font-semibold dark:border-slate-700">Cancel</button></div>
  </form>;
}

function StatusBadge({ status }) {
  const color = { OPEN: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200', PAUSED: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200', CANCELLED: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300', CLOSED: 'bg-slate-900 text-white dark:bg-slate-700', EXPIRED: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200', FULFILLED: 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200' }[status];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${color}`}>{status}</span>;
}

function Detail({ label, value }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}

function RequestMatches({ request }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`${API}/requests/${request.id}/matches`, { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || 'Could not load match responses.');
        if (active) setData(result);
      })
      .catch((reason) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request.id, reload]);

  return <section className="mt-7 border-t border-slate-200 pt-6 dark:border-slate-800">
    <div className="flex items-center justify-between gap-3"><div><h4 className="text-lg font-bold">Matches</h4><p className="text-sm text-slate-500">Anonymous candidate and response summary</p></div><button onClick={() => setReload((value) => value + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Refresh</button></div>
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading match responses…</p> : error ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p> : <>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MatchCount label="Potential" value={data.counts.potentialMatches} />
        <MatchCount label="Notified" value={data.counts.notified} />
        <MatchCount label="Accepted" value={data.counts.accepted} />
        <MatchCount label="Declined" value={data.counts.declined} />
        <MatchCount label="Pending" value={data.counts.pending} />
      </dl>
      {data.matches.length === 0 ? <p className="mt-4 text-sm text-slate-500">No potential candidates have been generated yet.</p> : <ul className="mt-4 space-y-2">{data.matches.map((match, index) => <li key={`${match.locationMatch}-${match.status}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"><span>Anonymous candidate · {match.locationMatch.toLowerCase()} level</span><span className="font-semibold">{match.status.replaceAll('_', ' ')}</span></li>)}</ul>}
      <p className="mt-4 text-xs leading-5 text-slate-500">{data.medicalNotice}</p>
    </>}
  </section>;
}

function MatchCount({ label, value }) {
  return <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-bold">{value}</dd></div>;
}
