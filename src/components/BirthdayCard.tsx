import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { localDateKey } from '../domain/time';
import { validDob } from '../domain/profile';
import { Spinner, useToast } from './ui';

/** Asks once for the date of birth. Teachers must answer before using My classes. */
export function BirthdayCard({ onSaved, forTeacher = false }: { onSaved: () => Promise<void>; forTeacher?: boolean }) {
  const user = useAuth().session?.user;
  const toast = useToast();
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="card flex flex-wrap items-end gap-3 border-2 border-brand-200 p-4" aria-labelledby="dob-h">
      <div className="min-w-0 flex-1 basis-56">
        <h2 id="dob-h" className="font-bold">🎂 When’s your birthday?</h2>
        <p className="text-sm text-ink-soft">
          {forTeacher
            ? 'Add your date of birth to see your classes, so the studio can celebrate with you. Only the studio sees it.'
            : 'Add your date of birth so your teacher can celebrate with you. Only studio staff see it.'}
        </p>
        <input className="input mt-2" type="date" min="1900-01-01" max={localDateKey(new Date())} value={dob} onChange={(e) => setDob(e.target.value)} aria-label="Date of birth" />
      </div>
      <button className="btn-primary btn-sm w-full sm:w-auto" disabled={busy || !user || !validDob(dob)} onClick={async () => {
        if (!user) return;
        setBusy(true);
        try {
          await api.updateProfile(user.id, { date_of_birth: dob });
          await onSaved();
          toast('Thanks! Saved.');
        } catch {
          toast('Please enter a valid date of birth.', 'error');
        } finally {
          setBusy(false);
        }
      }}>{busy && <Spinner />}Save</button>
    </section>
  );
}
