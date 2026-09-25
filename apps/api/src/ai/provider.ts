/**
 * AI service boundary (docs/APP_FLOW.md §3 "AI Services").
 * The backend only talks to this interface. MockAiProvider (mock.ts) is a deterministic
 * rule-based implementation for dev, demo and tests; a real LLM provider plugs in here.
 *
 * Rules every implementation must respect (enforced again by the caller):
 *  - proposals cite text that exists in the work (anchors / quotes), or they are dropped (AC-03)
 *  - unreadable or missing material yields no proposal, never a guess (AC-10)
 *  - coaching returns questions, never content written for the learner (TX-08)
 */
import type { Grade } from '@ideax/contracts';

export class AiUnavailableError extends Error {
  constructor() {
    super('AI provider unavailable');
  }
}

export interface ItemHints {
  /** regex sources (case-insensitive) that indicate the item is present */
  cues?: string[];
  /** material the item depends on */
  needs?: 'figure_text' | 'reference_list' | 'other_chapter' | 'section_structure';
  /** item is part of the advisory precheck */
  precheck?: boolean;
  /** student-facing text when present / absent */
  fbPresent?: string;
  fbAbsent?: string;
}

export interface RubricItemInput {
  no: string;
  text: string;
  hints: ItemHints;
}

export interface AnchorOut {
  start: number;
  end: number;
  /** hash of content.slice(start, end); the caller re-checks it */
  hash: string;
  loc: string | null;
}

export type ProposalKind = 'presence' | 'absence' | 'gap' | 'unreadable';

export interface ProposalOut {
  itemNo: string;
  grade: Grade | null;
  kind: ProposalKind;
  why: string;
  feedback: string;
  anchors: AnchorOut[];
  reasonCode?: 'extraction_gap' | 'missing_artifact' | 'other_chapter';
}

export interface PersonaFact {
  keywords: string[];
  answer: string;
}
export interface PersonaInput {
  name: string;
  role: string;
  facts: PersonaFact[];
}

export interface CoachOut {
  questions: string[];
  missingEvidence: boolean;
  /** 1–4 quality band, shown as an AI proposal (blue) */
  band: number;
}

export interface CriterionInput {
  key: string;
  name: string;
  stage: number;
  cues: string[];
}
export interface BandOut {
  key: string;
  band: number;
  why: string;
  quotes: string[];
}

export interface AiProvider {
  readonly model: string;
  setDown(down: boolean): void;
  isDown(): boolean;

  analyzeSubmission(input: { content: string; items: RubricItemInput[] }): Promise<ProposalOut[]>;
  verificationQuestions(content: string): Promise<string[]>;
  judgeExplanation(input: { question: string; answer: string }): Promise<{ explained: boolean; why: string }>;

  personaReply(input: { persona: PersonaInput; question: string }): Promise<string>;
  coach(input: { section: string; text: string }): Promise<CoachOut>;
  pushbackChallenge(input: { canvas: Record<string, string>; round: number }): Promise<{ section: string; challenge: string }>;
  pushbackJudge(input: { section: string; defense: string }): Promise<{ passed: boolean; why: string }>;
  scoreAttempt(input: { text: string; criteria: CriterionInput[] }): Promise<BandOut[]>;
}
