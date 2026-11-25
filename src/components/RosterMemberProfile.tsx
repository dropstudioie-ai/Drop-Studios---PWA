import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RosterEntry } from '../api/types';
import { photoUrl } from '../lib/avatar';
import { useBackToClose } from '../lib/useBackToClose';
import { initials } from './Avatar';
import { MemberPhotoButton } from './MemberPhotoButton';

const KIND_LABEL: Record<RosterEntry['kind'], string> = { membership: 'Membership', drop_in: 'Drop In', ticket: 'Ticket', staff: 'Instructor · free' };
const STATUS_LABEL: Record<string, string> = { booked: 'Booked', attended: 'Attended ✓', no_show: 'No-show', pending_payment: 'Paying now…' };

/** One member from the class list: big photo (tap to see it full screen), details, and back to the list. */
export function RosterMemberProfile({ b, isAdmin, canMark, onBack, onMark, onPhotoSaved }: {
  b: RosterEntry; isAdmin: boolean; canMark: boolean;
  onBack: () => void; onMark: (status: 'attended' | 'no_show') => void; onPhotoSaved: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    photoUrl(b.avatar_path).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [b.avatar_path]);

  return (
    <div className="space-y-4">
      <button className="btn-ghost btn-sm -ml-2" onClick={onBack}>← Back to class list</button>
      <div className="flex flex-col items-center text-center">
        {url ? (
          <button className="rounded-full ring-4 ring-brand-100 transition hover:ring-brand-400" onClick={() => setFull(true)} aria-label={`Open ${b.full_name}’s photo`}>
            <img src={url} alt={`${b.full_name}’s profile photo`} className="h-40 w-40 rounded-full object-cover" />
          </button>
        ) : (
          <span className="inline-flex h-40 w-40 items-center justify-center rounded-full bg-brand-100 text-5xl font-bold text-brand-700" aria-hidden="true">{initials(b.full_name)}</span>
        )}
        {url && <p className="mt-1 text-xs text-muted">Tap the photo to enlarge</p>}
        <h3 className="mt-3 text-2xl font-black">{b.full_name}</h3>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5 text-xs">
          {b.is_new && <span className="chip bg-brand-600 text-white">New · first class</span>}
          {b.is_birthday && <span className="chip bg-accent-500 text-ink">🎂 Birthday{b.turning ? ` · ${b.turning}` : ''}</span>}
          <span className="chip bg-canvas text-ink">{b.kind === 'membership' && b.plan_name ? b.plan_name : KIND_LABEL[b.kind]}</span>
          <span className="chip bg-canvas text-ink">{STATUS_LABEL[b.status] ?? b.status}</span>
        </div>
      </div>

      {b.guest_name && <p className="rounded-2xl bg-accent-50 p-3 text-sm">👯 Bringing {b.guest_count && b.guest_count > 1 ? `${b.guest_count} friends` : 'a friend'}: <strong>{b.guest_name}</strong></p>}

      {(b.phone || b.email) && (
        <div className="space-y-1 rounded-2xl bg-canvas p-3 text-sm">
          {b.phone && <p>📞 <a className="font-semibold text-brand-700" href={`tel:${b.phone.replace(/\s/g, '')}`}>{b.phone}</a></p>}
          {b.email && <p className="truncate">✉️ <a className="text-brand-700" href={`mailto:${b.email}`}>{b.email}</a></p>}
        </div>
      )}

      {!b.avatar_path && b.kind !== 'staff' && <MemberPhotoButton memberId={b.user_id} name={b.full_name} hasPhoto={false} onSaved={onPhotoSaved} className="btn-accent w-full" />}

      {canMark && b.status !== 'pending_payment' && (
        <div className="grid grid-cols-2 gap-2">
          <button className={`btn ${b.status === 'attended' ? 'bg-success text-white' : 'btn-outline'}`} onClick={() => onMark('attended')}>Here</button>
          <button className={`btn ${b.status === 'no_show' ? 'bg-ink text-white' : 'btn-outline'}`} onClick={() => onMark('no_show')}>No-show</button>
        </div>
      )}
      {isAdmin && b.kind !== 'staff' && <Link to={`/admin/customers?user=${b.user_id}`} className="btn-ghost w-full">Open full member page →</Link>}
      <button className="btn-primary w-full" onClick={onBack}>Back to class list</button>

      {full && url && <PhotoViewer url={url} name={b.full_name} onClose={() => setFull(false)} />}
    </div>
  );
}

function PhotoViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useBackToClose(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-ink/95 p-4" role="dialog" aria-modal="true" aria-label={`${name}’s photo`} onClick={onClose}>
      <img src={url} alt={`${name}’s profile photo`} className="max-h-[80vh] max-w-full rounded-2xl object-contain" />
      <p className="mt-3 font-semibold text-white">{name}</p>
      <button className="btn mt-3 border-2 border-white/40 text-white" onClick={onClose}>Close</button>
    </div>
  );
}
