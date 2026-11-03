import { useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

export default function DonorDiscovery() {
  const [filters, setFilters] = useState({ bloodGroup: 'O+', division: '', district: '', area: '' });
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function search(event, nextPage = 1) {
    event?.preventDefault();
    setLoading(true);
    setError('');
    setPage(nextPage);
    try {
      const params = new URLSearchParams({ ...filters, page: String(nextPage), limit: '20' });
      for (const key of ['district', 'area']) if (!params.get(key)) params.delete(key);
      const response = await fetch(`${API}/donors/discover?${params}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not search for donors.');
      setResult(data);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }

  function change(event) { setFilters((current) => ({ ...current, [event.target.name]: event.target.value })); }

  return (
    <section className="space-y-6">
      <header><p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">Privacy-conscious search</p><h2 className="mt-2 text-2xl font-bold">Donor Discovery</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Only donors who have opted in, are available, and have active accounts can appear.</p></header>
      <form onSubmit={search} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium">Blood group<select name="bloodGroup" value={filters.bloodGroup} onChange={change} className={inputClass}>{GROUPS.map((group) => <option key={group}>{group}</option>)}</select></label>
          <label className="text-sm font-medium">Division<input name="division" value={filters.division} onChange={change} maxLength="80" required className={inputClass} /></label>
          <label className="text-sm font-medium">District (optional)<input name="district" value={filters.district} onChange={change} maxLength="80" className={inputClass} /></label>
          <label className="text-sm font-medium">Area/locality (requires district)<input name="area" value={filters.area} onChange={change} maxLength="100" className={inputClass} /></label>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Area searches match the exact area within the selected district and division. Search results never show a donor’s area, contact details, or account identifier.</p>
        <button disabled={loading} className="mt-5 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{loading ? 'Searching…' : 'Search donors'}</button>
      </form>

      <p className="rounded-xl border-l-4 border-rose-600 bg-rose-50 p-4 text-sm leading-6 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">Potential candidates only. Qualified medical professionals must verify donor suitability and blood compatibility. This search does not provide medical approval.</p>
      {error && <p role="alert" className="rounded-xl bg-rose-100 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
      {result && !loading && (result.donors.length === 0 ? <div className="rounded-2xl bg-white p-8 text-center text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">No consenting available candidates found for these filters.</div> : <>
        <div className="flex items-center justify-between"><h3 className="font-bold">Potential candidates <span className="font-normal text-slate-500">({result.pagination.total})</span></h3><span className="text-sm text-slate-500">Page {result.pagination.page} of {Math.max(1, result.pagination.totalPages)}</span></div>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {result.donors.map((donor, index) => <li key={`${donor.bloodGroup}-${index}`} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Potential candidate</p><h4 className="mt-1 text-lg font-bold">Anonymous donor</h4></div><span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-200">{donor.bloodGroup}</span></div>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Area-level filter: {donor.locationMatch.toLowerCase()}</p>
            <p className="mt-3 text-xs text-slate-500">Contact and precise location remain private.</p>
          </li>)}
        </ul>
        <div className="flex justify-center gap-3"><button disabled={page <= 1 || loading} onClick={(event) => search(event, page - 1)} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40 dark:border-slate-700">Previous</button><button disabled={page >= result.pagination.totalPages || loading} onClick={(event) => search(event, page + 1)} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40 dark:border-slate-700">Next</button></div>
      </>)}
    </section>
  );
}
