import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { classPages } from '../lib/classPages';

const KEY = 'drop.profile-request.later';

/** On sign-in, instructors who haven't written their bio or class details yet are asked to do it. */
export function ProfileRequestPrompt() {
  const { session, isStaff } = useAuth();
  const uid = session?.user.id;
  const { pathname } = useLocation();
  const [todo, setTodo] = useState(false);
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } });

  useEffect(() => {
    if (!uid || !isStaff) { setTodo(false); return; }
    let live = true;
    classPages.mine().then((p) => live && setTodo(Boolean(p?.todo))).catch(() => {});
    return () => { live = false; };
  }, [uid, isStaff, pathname === '/teach/profile']);

  if (!todo || later || pathname === '/teach/profile') return null;
  const dismiss = () => { setLater(true); try { sessionStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ } };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="pr-h">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <p className="text-4xl">✍️</p>
        <h2 id="pr-h" className="mt-2 text-2xl font-black">Your class has its own page now</h2>
        <p className="mt-2 text-ink-soft">
          New people will find it on Google. We wrote a first draft. Please check your bio and describe your class
          (level, what to wear and bring, tips for a first class) so it sounds like you. It takes about 5 minutes.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link to="/teach/profile" onClick={dismiss} className="btn-accent text-lg">Do it now</Link>
          <button className="btn-outline" onClick={dismiss}>Later today</button>
        </div>
      </div>
    </div>
  );
}
