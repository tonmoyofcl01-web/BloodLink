import { useEffect, useRef, useState } from 'react';

const API = import.meta.env.VITE_API_URL || '/api/v1';
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const emptyApplication = { name: '', type: 'HOSPITAL', registrationNumber: '', division: '', district: '', area: '', publicContactPhone: '', verificationInfo: '' };

export default function OrganizationWorkspace({ focusOrganizationId }) {
  const [organizations, setOrganizations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [form, setForm] = useState(emptyApplication);
  const [requestOpen, setRequestOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadOrganizations() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/organizations/mine`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not load organizations.');
      setOrganizations(data.organizations);
      const wanted = focusOrganizationId || selected?.id;
      const next = data.organizations.find((item) => item.id === wanted) || data.organizations[0] || null;
      setSelected(next);
      if (next) await loadDashboard(next.id);
      else setDashboard(null);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }
  async function loadDashboard(id) {
    const response = await fetch(`${API}/organizations/mine/${id}/dashboard`, { credentials: 'include' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Could not load organization dashboard.');
    setDashboard(data);
  }
  useEffect(() => { loadOrganizations(); }, [focusOrganizationId]);

  async function submitApplication(event) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/organizations`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not submit the application.');
      setForm(emptyApplication); setMessage('Application submitted. Organization features remain locked until administrator verification.');
      await loadOrganizations();
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  }

  async function createRequest(event) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    body.unitsRequested = Number(body.unitsRequested); body.neededAt = new Date(body.neededAt).toISOString();
    try {
      const response = await fetch(`${API}/organizations/mine/${selected.id}/requests`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not create organization request.');
      setMessage('Organization request created and candidate matching started.'); setRequestOpen(false); await loadDashboard(selected.id);
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  }

  return <section className="space-y-6">
    <header><p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">Organization network</p><h2 className="mt-2 text-2xl font-bold">Hospitals & blood banks</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Applications are reviewed by a BloodLink administrator. Only verified organizations can use organization request features.</p></header>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
    {loading ? <p className="rounded-2xl bg-white p-6 text-slate-500 shadow-sm dark:bg-slate-900">Loading organization information…</p> : <>
      {organizations.length > 0 && <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"><h3 className="font-bold">Your organizations</h3><ul className="mt-3 space-y-2">{organizations.map((organization) => <li key={organization.id}><button onClick={() => { setSelected(organization); loadDashboard(organization.id).catch((reason) => setError(reason.message)); }} className={`w-full rounded-xl border p-3 text-left ${selected?.id === organization.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30' : 'border-slate-200 dark:border-slate-800'}`}><span className="flex items-center justify-between gap-2 font-semibold"><span>{organization.name}</span><VerificationBadge status={organization.status} /></span><span className="mt-1 block text-xs text-slate-500">{organization.type.replace('_', ' ')} · {organization.membership.role.toLowerCase()}</span></button></li>)}</ul></section>
        {dashboard && <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{dashboard.organization.name}</h3><p className="mt-1 text-sm text-slate-500">{dashboard.organization.registrationNumber} · {dashboard.organization.district}, {dashboard.organization.division}</p></div><VerificationBadge status={dashboard.organization.status} /></div>
          {dashboard.organization.status === 'PENDING' && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Verification is pending. Organization request features will unlock after approval.</p>}
          {dashboard.organization.status === 'REJECTED' && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">This application was not approved. Contact an administrator for guidance.</p>}
          {dashboard.organization.status === 'SUSPENDED' && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">Organization access is suspended.</p>}
          {dashboard.organization.status === 'VERIFIED' && <><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(dashboard.requestStatusCounts).map(([status, count]) => <div key={status} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs text-slate-500">{status}</p><p className="text-xl font-bold">{count}</p></div>)}</div><button onClick={() => setRequestOpen((value) => !value)} className="mt-4 rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white">{requestOpen ? 'Close request form' : 'Create organization request'}</button></>}
          {requestOpen && <form onSubmit={createRequest} className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800 sm:grid-cols-2"><label className="text-sm">Blood group<select name="bloodGroup" className={inputClass}>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => <option key={group}>{group}</option>)}</select></label><label className="text-sm">Units<input name="unitsRequested" type="number" min="1" max="1000" defaultValue="1" required className={inputClass} /></label><label className="text-sm">Urgency<select name="urgency" className={inputClass}><option value="URGENT">Urgent</option><option value="SCHEDULED">Scheduled</option></select></label><label className="text-sm">Required by<input name="neededAt" type="datetime-local" required className={inputClass} /></label>{['division', 'district', 'area'].map((name) => <label key={name} className="text-sm capitalize">{name}<input name={name} defaultValue={dashboard.organization[name]} required className={inputClass} /></label>)}<label className="text-sm sm:col-span-2">Facility name<input name="facilityName" defaultValue={dashboard.organization.name} className={inputClass} /></label><button disabled={saving} className="rounded-xl bg-teal-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Creating…' : 'Create request'}</button></form>}
          <div className="mt-5"><h4 className="font-semibold">Organization requests</h4>{dashboard.requests.length === 0 ? <p className="mt-2 text-sm text-slate-500">No organization requests yet.</p> : <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">{dashboard.requests.map((request) => <li key={request.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span><strong className="text-rose-700 dark:text-rose-300">{request.bloodGroup} · {request.unitsRequested} units</strong><span className="ml-2 text-slate-500">{request.district}, {request.division}</span></span><VerificationBadge status={request.status} /></li>)}</ul>}</div>
          <div className="mt-5 grid gap-5 border-t border-slate-200 pt-4 dark:border-slate-800 sm:grid-cols-2"><div><h4 className="font-semibold">Authorized members</h4><ul className="mt-2 space-y-2 text-sm">{dashboard.staff.map((staff, index) => <li key={`${staff.user.fullName}-${index}`} className="flex justify-between"><span>{staff.user.fullName}</span><span className="text-slate-500">{staff.role.toLowerCase()}</span></li>)}</ul></div><div><h4 className="font-semibold">Recent activity</h4><ul className="mt-2 space-y-2 text-sm">{dashboard.activity.map((event) => <li key={`${event.action}-${event.createdAt}`}><span className="font-medium">{event.action.toLowerCase()}</span><span className="ml-2 text-slate-500">{new Date(event.createdAt).toLocaleDateString()}</span>{event.reason && <p className="text-xs text-slate-500">{event.reason}</p>}</li>)}</ul></div></div>
        </section>}
      </div>}
      <form onSubmit={submitApplication} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:p-7"><h3 className="text-lg font-bold">Register an organization</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">New applications are always pending. Registration does not grant administrator or verified status.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">Organization name<input name="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength="180" className={inputClass} /></label><label className="text-sm">Organization type<select name="type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className={inputClass}><option value="HOSPITAL">Hospital</option><option value="BLOOD_BANK">Blood bank</option></select></label><label className="text-sm">Registration number<input name="registrationNumber" value={form.registrationNumber} onChange={(event) => setForm({ ...form, registrationNumber: event.target.value })} required maxLength="80" className={inputClass} /></label><label className="text-sm">Public contact phone<input name="publicContactPhone" type="tel" value={form.publicContactPhone} onChange={(event) => setForm({ ...form, publicContactPhone: event.target.value })} required maxLength="32" className={inputClass} /></label>{['division', 'district', 'area'].map((name) => <label key={name} className="text-sm capitalize">{name}<input name={name} value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} required className={inputClass} /></label>)}<label className="text-sm sm:col-span-2">Verification information<textarea name="verificationInfo" value={form.verificationInfo} onChange={(event) => setForm({ ...form, verificationInfo: event.target.value })} maxLength="1000" rows="3" className={inputClass} /><span className="mt-1 block text-xs text-slate-500">Visible only to authorized organization members and administrators.</span></label></div><button disabled={saving} className="mt-5 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Submitting…' : 'Submit for verification'}</button></form>
    </>}
  </section>;
}

export function OrganizationAdminWorkspace({ focusOrganizationId, onBackToNotifications }) {
  const [status, setStatus] = useState('PENDING');
  const [organizations, setOrganizations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const dialogRef = useRef(null);

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/admin/organizations?status=${status}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not load applications.');
      setOrganizations(data.organizations);
      if (focusOrganizationId) {
        setSelected(null);
        await inspect(focusOrganizationId);
      } else {
        const next = data.organizations.find((item) => item.id === selected?.id) || data.organizations[0] || null;
        if (next) await inspect(next.id); else setSelected(null);
      }
    } catch (reasonValue) {
      setSelected(null);
      setError(focusOrganizationId
        ? 'This organization application is no longer available. It may have been removed. Return to notifications to open another item.'
        : reasonValue.message);
    }
    finally { setLoading(false); }
  }
  async function inspect(id) {
    const response = await fetch(`${API}/admin/organizations/${id}`, { credentials: 'include' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Could not inspect application.');
    setSelected(data.organization);
  }
  useEffect(() => { load(); }, [status, focusOrganizationId]);
  useEffect(() => {
    if (!decision || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), textarea:not([disabled])')];
    focusable()[0]?.focus();
    function handleKeyDown(event) {
      if (event.key === 'Escape') { setDecision(null); setReason(''); }
      if (event.key === 'Tab') {
        const controls = focusable();
        if (!controls.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [decision]);

  async function applyDecision() {
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/admin/organizations/${selected.id}/decision`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not save verification decision.');
      setMessage(`Organization ${({ APPROVE: 'approved', REJECT: 'rejected', SUSPEND: 'suspended' })[decision]}.`); setDecision(null); setReason(''); await load();
    } catch (reasonValue) { setError(reasonValue.message); }
    finally { setSaving(false); }
  }

  return <section className="space-y-5"><header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">Administrator</p><h2 className="mt-2 text-2xl font-bold">Organization verification</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Review submitted organization details and record every decision.</p></div>{focusOrganizationId && <button onClick={onBackToNotifications} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Back to notifications</button>}</header>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
    <label className="text-sm font-semibold">Application status<select value={status} onChange={(event) => setStatus(event.target.value)} className={`${inputClass} max-w-xs`}><option>PENDING</option><option>VERIFIED</option><option>REJECTED</option><option>SUSPENDED</option></select></label>
    {loading ? <p className="rounded-2xl bg-white p-6 text-slate-500 shadow-sm dark:bg-slate-900">Loading applications…</p> : organizations.length === 0 ? <p className="rounded-2xl bg-white p-8 text-center text-slate-500 shadow-sm dark:bg-slate-900">No {status.toLowerCase()} organizations.</p> : <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><ul className="space-y-2">{organizations.map((organization) => <li key={organization.id}><button onClick={() => inspect(organization.id).catch((reasonValue) => setError(reasonValue.message))} className={`w-full rounded-xl border p-4 text-left ${selected?.id === organization.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}><span className="flex justify-between gap-2 font-semibold">{organization.name}<VerificationBadge status={organization.status} /></span><span className="mt-1 block text-xs text-slate-500">{organization.type.replace('_', ' ')} · {organization.district}</span></button></li>)}</ul>
      {selected && <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"><header className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-xl font-bold">{selected.name}</h3><p className="mt-1 text-sm text-slate-500">Submitted by {selected.creator.fullName} · {selected.creator.email}</p></div><VerificationBadge status={selected.status} /></header><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">{[['Type', selected.type], ['Registration number', selected.registrationNumber], ['Location', `${selected.area}, ${selected.district}, ${selected.division}`], ['Public phone', selected.publicContactPhone], ['Verification information', selected.verificationInfo || 'None provided']].map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl><h4 className="mt-6 font-semibold">Verification history</h4><ul className="mt-2 space-y-2 text-sm">{selected.verificationHistory.map((event) => <li key={`${event.action}-${event.createdAt}`} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><strong>{event.action}</strong><span className="ml-2 text-slate-500">{new Date(event.createdAt).toLocaleString()}</span>{event.reason && <p className="mt-1 text-slate-600 dark:text-slate-300">{event.reason}</p>}</li>)}</ul><div className="mt-5 flex flex-wrap gap-2">{selected.status === 'PENDING' && <><button onClick={() => setDecision('APPROVE')} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Approve</button><button onClick={() => setDecision('REJECT')} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white">Reject</button></>}{selected.status === 'VERIFIED' && <button onClick={() => setDecision('SUSPEND')} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white">Suspend organization</button>}</div></article>}</div>}
    {decision && <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDecision(null); }}><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="decision-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"><h3 id="decision-title" className="text-xl font-bold">Confirm {decision.toLowerCase()}</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">This change will be recorded in the organization’s verification history.</p>{decision !== 'APPROVE' && <label className="mt-4 block text-sm font-medium">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength="500" rows="3" required className={inputClass} /></label>}<div className="mt-5 flex justify-end gap-2"><button onClick={() => { setDecision(null); setReason(''); }} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold dark:border-slate-700">Cancel</button><button disabled={saving || (decision !== 'APPROVE' && !reason.trim())} onClick={applyDecision} className="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : `Confirm ${decision.toLowerCase()}`}</button></div></section></div>}
  </section>;
}

function VerificationBadge({ status }) {
  const styles = { PENDING: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200', VERIFIED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200', REJECTED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200', SUSPENDED: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200', OPEN: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200', PAUSED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200', CLOSED: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200', CANCELLED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200', EXPIRED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200', FULFILLED: 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200' };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${styles[status] || styles.PENDING}`}>{status}</span>;
}
