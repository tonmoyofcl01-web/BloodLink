import { useEffect, useRef, useState } from 'react';
import { runVerificationOnce } from './auth/verification-once.js';
import RequestWorkspace from './features/requests/RequestWorkspace.jsx';
import DonorDiscovery from './features/discovery/DonorDiscovery.jsx';
import MyOpportunities from './features/donors/MyOpportunities.jsx';
import NotificationsPage, { NotificationBell } from './features/notifications/NotificationsCenter.jsx';
import OrganizationWorkspace, { OrganizationAdminWorkspace } from './features/organizations/OrganizationWorkspace.jsx';

const API = import.meta.env.VITE_API_URL || '/api/v1';
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const EMPTY_PROFILE = { displayName: '', bloodGroup: 'O+', division: '', district: '', area: '' };

export default function App() {
  const [mode, setMode] = useState('login');
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [dark, setDark] = useState(() => window.localStorage.getItem('bloodlink-theme') === 'dark');
  const verificationSubmitted = useRef(false);
  const authSubmitInFlight = useRef(false);
  const resendInFlight = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem('bloodlink-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (window.location.pathname === '/verify-email' && token) {
      // React StrictMode replays effects in development. Verification tokens are one-time
      // credentials, so a replay would consume the token twice and replace success with an error.
      runVerificationOnce(verificationSubmitted, () => {
        fetch(`${API}/auth/verify-email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
        }).then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error?.message || 'Verification failed.');
          setMessage('Email verified. You can now sign in.');
          window.history.replaceState({}, '', '/');
        }).catch((error) => setMessage(error.message));
      });
    }
    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.user) setUser(data.user); })
      .catch(() => {});
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (authSubmitInFlight.current) return;
    authSubmitInFlight.current = true;
    setMessage('');
    setBusy(true);
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (mode === 'register') setVerificationEmail(body.email);
    try {
      const response = await fetch(`${API}/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        if (mode === 'login' && data.error?.code === 'EMAIL_NOT_VERIFIED') setVerificationEmail(body.email);
        throw new Error(data.error?.message || 'Unable to complete request.');
      }
      if (data.user) setUser(data.user);
      setMessage(mode === 'register' ? data.message : 'Signed in successfully.');
    } catch (error) { setMessage(error.message); }
    finally { authSubmitInFlight.current = false; setBusy(false); }
  }

  async function resendVerification() {
    if (resendInFlight.current) return;
    resendInFlight.current = true;
    setResendBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${API}/auth/resend-verification`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: verificationEmail }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not resend verification instructions.');
      setMessage(data.message);
    } catch (error) { setMessage(error.message); }
    finally { resendInFlight.current = false; setResendBusy(false); }
  }

  async function logout() {
    const response = await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    if (response.ok) { setUser(null); setMessage('You have signed out.'); }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex max-w-6xl justify-end">
        <ThemeToggle dark={dark} onToggle={() => setDark((value) => !value)} />
      </div>
      {user ? <UserWorkspace key={user.id} user={user} onLogout={logout} /> : (
        <section className="mx-auto mt-6 grid max-w-5xl overflow-hidden rounded-3xl bg-white shadow-xl shadow-slate-200/70 dark:bg-slate-900 dark:shadow-black/20 md:grid-cols-2">
          <div className="bg-rose-700 p-10 text-white md:p-14">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-100">BloodLink</p>
            <h1 className="mt-12 text-4xl font-bold leading-tight">A stronger network for every urgent need.</h1>
            <p className="mt-5 max-w-sm text-rose-100">A secure network for people working to connect blood donors with those who need help.</p>
          </div>
          <div className="p-8 md:p-14">
            <h2 className="text-3xl font-bold">{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-300">{mode === 'register' ? 'Start with a secure individual account.' : 'Sign in to continue to BloodLink.'}</p>
            <form onSubmit={submit} className="mt-8 space-y-4">
              {mode === 'register' && <Field name="fullName" label="Full name" autoComplete="name" required />}
              <Field name="email" label="Email address" type="email" autoComplete="email" required />
              <Field name="password" label="Password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={12} required />
              {message && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{message}</p>}
              <button disabled={busy} className="w-full rounded-xl bg-rose-700 px-5 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-60">{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
            </form>
            <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setVerificationEmail(''); setMessage(''); }} className="mt-5 text-sm font-medium text-rose-700 hover:underline dark:text-rose-300">
              {mode === 'register' ? 'Already have an account? Sign in' : 'New to BloodLink? Create an account'}
            </button>
            {verificationEmail && <button type="button" onClick={resendVerification} disabled={resendBusy} className="ml-4 mt-5 text-sm font-medium text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300">{resendBusy ? 'Sending…' : 'Resend verification email'}</button>}
          </div>
        </section>
      )}
    </main>
  );
}

function UserWorkspace({ user, onLogout }) {
  const [view, setView] = useState('profile');
  const [focus, setFocus] = useState(null);
  const navItems = [
    ['profile', 'Donor Profile'],
    ['requests', 'Blood Requests'],
    ['discovery', 'Donor Discovery'],
    ['opportunities', 'My Opportunities'],
    ['organizations', 'Organizations'],
    ...(user.isAdmin ? [['admin-organizations', 'Verification Admin']] : []),
    ['notifications', 'Notifications'],
  ];
  function navigate(destination) {
    setFocus(destination);
    setView(destination.view);
  }
  return <div className="mx-auto mt-6 max-w-6xl">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">BloodLink account</p><h1 className="mt-1 text-2xl font-bold">Hello, {user.fullName}</h1></div>
      <div className="flex items-center gap-3"><NotificationBell onNavigate={navigate} /><button onClick={onLogout} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900">Sign out</button></div>
    </header>
    <nav aria-label="BloodLink workspace" className="mb-6 flex gap-2 overflow-x-auto rounded-2xl bg-slate-200 p-1.5 dark:bg-slate-900">
      {navItems.map(([value, label]) => <button key={value} onClick={() => setView(value)} aria-current={view === value ? 'page' : undefined} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition ${view === value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{label}</button>)}
    </nav>
    {view === 'profile' ? <DonorManager user={user} />
      : view === 'requests' ? <RequestWorkspace key={`requests-${focus?.id || ''}`} focusRequestId={focus?.id} />
        : view === 'discovery' ? <DonorDiscovery />
          : view === 'opportunities' ? <MyOpportunities focusOpportunityId={focus?.id} />
            : view === 'notifications' ? <NotificationsPage onNavigate={navigate} />
              : view === 'organizations' || view === 'organization' ? <OrganizationWorkspace key={focus?.id || 'organizations'} focusOrganizationId={focus?.id} />
                : view === 'admin-organizations' ? <OrganizationAdminWorkspace key={focus?.id || 'admin'} focusOrganizationId={focus?.id} />
                  : <DonorManager user={user} />}
  </div>;
}

function DonorManager({ user }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_PROFILE, displayName: user.fullName });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch(`${API}/donors/me`, { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Could not load donor profile.');
        setProfile(data.profile);
        if (data.profile) setForm({ displayName: data.profile.displayName, bloodGroup: data.profile.bloodGroup, division: data.profile.division, district: data.profile.district, area: data.profile.area });
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`${API}/donors/me`, {
        method: profile ? 'PUT' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not save donor profile.');
      setProfile(data.profile);
      setForm({ displayName: data.profile.displayName, bloodGroup: data.profile.bloodGroup, division: data.profile.division, district: data.profile.district, area: data.profile.area });
      setMessage(profile ? 'Donor profile updated.' : 'Donor profile created. It starts paused and without discovery consent.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  async function changeAvailability(status) {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`${API}/donors/me/availability`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not update availability.');
      setProfile(data.profile);
      setMessage(status === 'PAUSED' ? 'Availability paused.' : 'Availability set to available. You remain excluded from discovery without consent.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  async function changeConsent(consented) {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`${API}/donors/me/consent`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consented }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not update consent.');
      setProfile(data.profile);
      setConsentChecked(false);
      setMessage(consented ? 'Discovery consent recorded.' : 'Discovery consent withdrawn. Your profile is excluded from future discovery.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  return (
    <section className="mx-auto max-w-4xl">
      {loading ? <p className="rounded-2xl bg-white p-6 text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">Loading your profile…</p> : (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <form onSubmit={saveProfile} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:p-8">
            <h2 className="text-xl font-bold">{profile ? 'Your donor details' : 'Create an optional donor profile'}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">You are not a donor until you create this profile. Your email and contact details are never shown here or shared through donor endpoints.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field name="displayName" label="Display name" value={form.displayName} onChange={updateField} maxLength={120} required />
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Blood group
                <select name="bloodGroup" value={form.bloodGroup} onChange={updateField} className={inputClass}>
                  {BLOOD_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
              </label>
              <Field name="division" label="Division" value={form.division} onChange={updateField} maxLength={80} required />
              <Field name="district" label="District" value={form.district} onChange={updateField} maxLength={80} required />
              <div className="sm:col-span-2">
                <Field name="area" label="Area or locality" value={form.area} onChange={updateField} maxLength={100} required />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Use a named administrative area or locality. Do not enter a street address, landmark, or coordinates. Only you can view and edit these location details.</p>
              </div>
            </div>
            {message && <p role="status" className="mt-5 rounded-xl bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{message}</p>}
            <button disabled={saving || loading} className="mt-6 rounded-xl bg-rose-700 px-5 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-60">{saving ? 'Saving…' : profile ? 'Save changes' : 'Create donor profile'}</button>
          </form>

          <aside className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <h2 className="text-lg font-bold">Availability</h2>
              {profile ? <>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Current status: <strong>{profile.availabilityStatus === 'AVAILABLE' ? 'Available' : 'Paused'}</strong></p>
                <div className="mt-4 flex gap-3">
                  <button disabled={saving || profile.availabilityStatus === 'AVAILABLE'} onClick={() => changeAvailability('AVAILABLE')} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Resume</button>
                  <button disabled={saving || profile.availabilityStatus === 'PAUSED'} onClick={() => changeAvailability('PAUSED')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">Pause</button>
                </div>
              </> : <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Create a donor profile to manage availability. New profiles start paused.</p>}
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <h2 className="text-lg font-bold">Discovery consent</h2>
              {profile?.discoveryConsent ? <>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Consent is active. You can withdraw it at any time; withdrawal excludes your profile from future discovery.</p>
                <button disabled={saving} onClick={() => changeConsent(false)} className="mt-4 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950">Withdraw consent</button>
              </> : <>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Your profile is excluded unless you opt in. Consent only allows future discovery to consider your donor profile; it does not reveal your contact details or private location.</p>
                <label className="mt-4 flex gap-3 text-sm leading-5 text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} className="mt-1 size-4 accent-rose-700" />
                  <span>I explicitly consent to being included in future donor discovery.</span>
                </label>
                <button disabled={!profile || !consentChecked || saving} onClick={() => changeConsent(true)} className="mt-4 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-50">Give consent</button>
              </>}
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-rose-600 focus:ring-2 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

function Field({ name, label, ...props }) {
  return <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">{label}<input name={name} {...props} className={inputClass} /></label>;
}

function ThemeToggle({ dark, onToggle }) {
  return <button onClick={onToggle} type="button" aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">{dark ? '☀ Light' : '☾ Dark'}</button>;
}
