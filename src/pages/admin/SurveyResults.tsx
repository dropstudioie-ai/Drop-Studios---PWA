import { useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { survey, ANSWER_LABEL, type SurveyAnswer } from '../../lib/survey';
import { range } from '../../lib/holidays';
import { SurveyDialog } from '../../components/SurveyPrompt';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorNotice, Spinner } from '../../components/ui';
import { Section, Table, Td } from './shared';

const KEY = 'december-2026';
const ORDER: SurveyAnswer[] = ['all_month', 'some_days', 'away_all', 'not_sure'];
const EMOJI: Record<SurveyAnswer, string> = { all_month: '💃', some_days: '✈️', away_all: '🎄', not_sure: '🤔' };

/** December plans survey: what members said, and how many are away on each day. */
export function SurveyResults() {
  const { session } = useAuth();
  const r = useAsync(() => survey.results(KEY), []);
  const [preview, setPreview] = useState(false);
  const d = r.data;
  const max = Math.max(1, ...(d?.days.map((x) => x.away) ?? [1]));
  const day = (k: string) => new Date(`${k}T12:00:00Z`);

  return (
    <Section title="🎄 December plans survey" actions={<button className="btn-outline btn-sm" onClick={() => setPreview(true)}>See what members see</button>}>
      {preview && session && <SurveyDialog preview survey={{ key: KEY, title: 'December plans', declines: 0 }} userId={session.user.id} onClose={() => setPreview(false)} />}
      {r.error ? <ErrorNotice error={r.error} onRetry={r.reload} /> : !d ? <Spinner /> : (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            Members are asked when they open the app until {new Date(`${d.ends_on}T12:00:00Z`).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}.
            {' '}<strong>{d.answered}</strong> answered{d.declined ? <>, {d.declined} said “not now” twice (not asked again)</> : null}.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ORDER.map((a) => (
              <div key={a} className="card p-4">
                <p className="text-2xl">{EMOJI[a]}</p>
                <p className="mt-1 font-display text-2xl font-black">{d.counts[a] ?? 0}</p>
                <p className="text-xs text-muted">{ANSWER_LABEL[a]}</p>
              </div>
            ))}
          </div>

          <div className="card p-4">
            <p className="text-sm font-bold">People away each day in December</p>
            <div className="mt-3 flex h-28 items-end gap-[3px]">
              {d.days.map((x) => {
                const dt = day(x.day); const wkd = dt.getUTCDay();
                return (
                  <div key={x.day} className="flex flex-1 flex-col items-center justify-end" title={`${dt.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${x.away} away`}>
                    {x.away > 0 && <span className="text-[10px] font-semibold text-muted">{x.away}</span>}
                    <div className={`w-full rounded-t ${wkd === 0 || wkd === 6 ? 'bg-accent-400' : 'bg-brand-400'}`} style={{ height: `${(x.away / max) * 80}px`, minHeight: x.away ? 4 : 1 }} />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted"><span>1 Dec</span><span>15 Dec</span><span>31 Dec</span></div>
            <p className="mt-2 text-xs text-muted">Counts “away some days” and “taking December off”. Weekends in orange.</p>
          </div>

          <Table head={['Member', 'Answer', 'Away', 'Pause booked', 'Member now']} empty={!d.rows.some((x) => x.answer)}>
            {d.rows.filter((x) => x.answer).map((x) => (
              <tr key={x.user_id} className="border-b border-line last:border-0">
                <Td className="font-semibold">{x.name}</Td>
                <Td>{EMOJI[x.answer!]} {ANSWER_LABEL[x.answer!]}</Td>
                <Td>{x.answer === 'some_days' && x.away_from && x.away_to ? range(x.away_from, x.away_to) : x.answer === 'away_all' ? 'All December' : '—'}</Td>
                <Td>{x.answer === 'some_days' || x.answer === 'away_all' ? (x.paused ? '✅ Yes' : 'Not yet') : '—'}</Td>
                <Td>{x.active_member ? 'Yes' : 'No'}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Section>
  );
}
