import { Link } from 'react-router-dom';

/**
 * Shown after paying, when a member who completed 3 months signs up again.
 * The wording is in one place so the studio can pick its favourite.
 */
export const rewardMessage = (name: string) => ({
  title: `${name ? `${name}, you've` : "You've"} found your rhythm! 💃`,
  body: 'To celebrate 3 months dancing at Drop, we’ve added 3 free classes to your account. Book any class you like in the next 7 days, on top of your new membership. Enjoy!',
});

export function LoyaltyRewardPopup({ name, onClose }: { name: string; onClose: () => void }) {
  const m = rewardMessage(name);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="reward-title" onClick={onClose}>
      <div className="relative w-full max-w-lg rounded-3xl bg-gradient-to-br from-accent-500 via-accent-400 to-brand-500 p-6 text-left text-white shadow-2xl sm:p-8" onClick={(e) => e.stopPropagation()}>
        <button className="absolute right-4 top-4 rounded-full p-2 text-white/80 hover:bg-white/10" aria-label="Close" onClick={onClose}>✕</button>
        <p className="text-5xl" aria-hidden="true">🎉</p>
        <p className="mt-2 text-sm font-extrabold uppercase tracking-wide text-white/85">Loyalty reward · 3 free classes</p>
        <h2 id="reward-title" className="mt-1 font-display text-3xl font-black uppercase leading-none tracking-tight">{m.title}</h2>
        <p className="mt-3 text-lg text-white/95">{m.body}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Link to="/timetable" className="btn bg-white text-brand-700 hover:bg-brand-50" onClick={onClose}>Book a free class</Link>
          <button className="btn border-2 border-white/70 text-white hover:bg-white/10" onClick={onClose}>Later</button>
        </div>
      </div>
    </div>
  );
}
