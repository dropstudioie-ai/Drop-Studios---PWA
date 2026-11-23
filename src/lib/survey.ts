import { supabase } from './supabase';
import { unwrap } from '../api';

export type SurveyAnswer = 'all_month' | 'some_days' | 'away_all' | 'not_sure';
export interface MySurvey { key: string; title: string; declines: number }
export interface SurveyRow {
  user_id: string; name: string; answer: SurveyAnswer | null; away_from: string | null; away_to: string | null;
  answered_at: string | null; declines: number; paused: boolean; active_member: boolean;
}
export interface SurveyResults {
  key: string; title: string; starts_on: string; ends_on: string; month: string;
  answered: number; declined: number; counts: Partial<Record<SurveyAnswer, number>>;
  rows: SurveyRow[]; days: { day: string; away: number }[];
}

export const survey = {
  mine: async () => unwrap(await supabase.rpc('my_survey')) as MySurvey | null,
  decline: async (key: string) => unwrap(await supabase.rpc('survey_decline', { p_key: key })),
  answer: async (key: string, answer: SurveyAnswer, from?: string, to?: string) =>
    unwrap(await supabase.rpc('survey_answer', { p_key: key, p_answer: answer, p_from: from ?? null, p_to: to ?? null })),
  results: async (key: string) => unwrap(await supabase.rpc('admin_survey_results', { p_key: key })) as SurveyResults,
};

export const ANSWER_LABEL: Record<SurveyAnswer, string> = {
  all_month: 'Dancing all December',
  some_days: 'Away some days',
  away_all: 'Away / taking a break all December',
  not_sure: 'Not sure yet',
};
