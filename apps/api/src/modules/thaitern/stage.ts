/**
 * 7-Stage progression with Sawtooth support (plan chapter 3, p.23–24).
 * Pure functions: no I/O, so the rule can be tested exhaustively.
 */
import type { SupportLevel } from '@ideax/contracts';

export interface StageState {
  supportLevel: SupportLevel;
  consecutiveSolo: number;
  lastSoloIndustry: string | null;
  mastered: boolean;
}

export const INITIAL_STAGE: StageState = { supportLevel: 'WATCH', consecutiveSolo: 0, lastSoloIndustry: null, mastered: false };

export interface StageResult {
  /** worked at SOLO level and used no hints for this stage */
  solo: boolean;
  /** a human-confirmed band at or above the pass band */
  passed: boolean;
  industry: string;
}

/**
 * TX-01: a stage is mastered after two CONSECUTIVE solo passes in two DIFFERENT industries.
 * Any non-solo or failed attempt breaks the streak. A failure brings support back (the saw's tooth);
 * a supported pass fades support one level (Watch → Guided → Solo).
 */
export function applyStageResult(s: StageState, r: StageResult): StageState {
  if (s.mastered) return s;
  if (r.solo && r.passed) {
    if (s.consecutiveSolo >= 1 && s.lastSoloIndustry !== null && s.lastSoloIndustry !== r.industry) {
      return { supportLevel: 'SOLO', consecutiveSolo: 2, lastSoloIndustry: r.industry, mastered: true };
    }
    // first solo pass, or a second one in the same industry (does not prove transfer; streak stays at 1)
    return { supportLevel: 'SOLO', consecutiveSolo: 1, lastSoloIndustry: r.industry, mastered: false };
  }
  if (r.passed) {
    const faded: SupportLevel = s.supportLevel === 'WATCH' ? 'GUIDED' : 'SOLO';
    return { supportLevel: faded, consecutiveSolo: 0, lastSoloIndustry: null, mastered: false };
  }
  return { supportLevel: 'GUIDED', consecutiveSolo: 0, lastSoloIndustry: null, mastered: false };
}

/** Stage n+1 opens at WATCH once stage n is mastered. Stage 1 is always open. */
export function openStages(states: Record<number, StageState>): number[] {
  const open = [1];
  for (let n = 1; n < 7; n++) if (states[n]?.mastered) open.push(n + 1);
  return open;
}
