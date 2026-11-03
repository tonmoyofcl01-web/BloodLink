import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

export default function App() {
  const [mode, setMode] = useState('login');
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (window.location.pathname === '/verify-email' && token) {
      fetch(`${API}/auth/verify-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Verification failed.');
        setMessage('Email verified. You can now sign in.');
        window.history.replaceState({}, '', '/');
      }).catch((error) => setMessage(error.message));
    }
    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.user) setUser(data.user); })
      .catch(() => {});
  }, []);

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch(`${API}/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Unable to complete request.');
      if (data.user) setUser(data.user);
      setMessage(mode === 'register' ? 'Account created. Check the development server output for the verification link.' : 'Signed in successfully.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    const response = await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    if (response.ok) { setUser(null); setMessage('You have signed out.'); }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-5 py-12">
      <section className="grid w-full overflow-hidden rounded-3xl bg-white shadow-xl shadow-slate-200/70 md:grid-cols-2">
        <div className="bg-rose-700 p-10 text-white md:p-14">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-100">BloodLink</p>
          <h1 className="mt-12 text-4xl font-bold leading-tight">A stronger network for every urgent need.</h1>
          <p className="mt-5 max-w-sm text-rose-100">A secure foundation for people and organizations working to connect blood donors with those who need help.</p>
        </div>
        <div className="p-8 md:p-14">
          {user ? <>
            <p className="text-sm font-semibold text-rose-700">SIGNED IN</p>
            <h2 className="mt-3 text-3xl font-bold">Welcome, {user.fullName}</h2>
            <p className="mt-3 text-slate-600">Your account is ready. Donor and request features will be added in later milestones.</p>
            <button onClick={logout} className="mt-8 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-700">Sign out</button>
          </> : <>
            <h2 className="text-3xl font-bold">{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
            <p className="mt-2 text-slate-600">{mode === 'register' ? 'Start with a secure individual account.' : 'Sign in to continue to BloodLink.'}</p>
            <form onSubmit={submit} className="mt-8 space-y-4">
              {mode === 'register' && <Field name="fullName" label="Full name" autoComplete="name" required />}
              <Field name="email" label="Email address" type="email" autoComplete="email" required />
              <Field name="password" label="Password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={12} required />
              {message && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
              <button disabled={busy} className="w-full rounded-xl bg-rose-700 px-5 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-60">{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
            </form>
            <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setMessage(''); }} className="mt-5 text-sm font-medium text-rose-700 hover:underline">
              {mode === 'register' ? 'Already have an account? Sign in' : 'New to BloodLink? Create an account'}
            </button>
            {message && <p role="status" className="mt-4 text-sm text-slate-600">{message}</p>}
          </>}
        </div>
      </section>
    </main>
  );
}

function Field({ name, label, ...props }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<input name={name} {...props} className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-rose-600 focus:ring-2 focus:ring-rose-100" /></label>;
}
