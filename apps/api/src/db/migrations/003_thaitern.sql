-- Gate 2 (journey) + Gate 3 (case production, evaluation) · THAItern

create table cases (
  id text primary key,
  org_id text not null references organizations(id),
  track text not null check (track in ('sme', 'community')),
  sme_group text,
  sub_category text not null,
  industry text not null,
  province text,
  title text not null,
  teaser text not null,
  challenge_brief text not null default '',
  status text not null,
  stages int[] not null default '{}',
  mask_terms text[] not null default '{}',
  reviewed_by text references users(id),
  reviewed_at timestamptz,
  review_notes text,
  approved_at timestamptz,
  published_at timestamptz,
  suspended_at timestamptz,
  compensation_baht int not null default 500,
  created_at timestamptz not null default now()
);

create table data_agreements (
  id text primary key,
  case_id text not null references cases(id),
  org_id text not null references organizations(id),
  signed_by text references users(id),
  signed_at timestamptz,
  term_years int not null default 10,
  takedown_days int not null default 7,
  allow_course_use boolean not null default true
);

create table case_assets (
  id text primary key,
  case_id text not null references cases(id),
  kind text not null check (kind in ('brief', 'audio_transcript', 'data', 'persona', 'finance', 'question', 'other')),
  name text not null,
  content text not null,
  markings text[] not null default '{}',
  usable_until date,
  anonymized_content text,
  created_at timestamptz not null default now()
);

create table case_versions (
  id text primary key,
  case_id text not null references cases(id),
  version_no int not null,
  booklet jsonb not null,
  data_room jsonb not null,
  personas jsonb not null,
  finance jsonb not null,
  questions jsonb not null,
  criteria jsonb not null,
  created_at timestamptz not null default now(),
  unique (case_id, version_no)
);

create table rounds (
  id text primary key,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null
);

create table teams (
  id text primary key,
  name text not null,
  created_by text not null references users(id),
  created_at timestamptz not null default now()
);

create table team_members (
  team_id text not null references teams(id),
  user_id text not null references users(id),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table attempts (
  id text primary key,
  round_id text not null references rounds(id),
  team_id text not null references teams(id),
  case_id text not null references cases(id),
  case_version_id text not null references case_versions(id),
  state text not null,
  first_draft text,
  first_draft_started_at timestamptz,
  first_draft_saved_at timestamptz,
  quiz_score int,
  access_code text,
  unlocked_at timestamptz,
  deadline_at timestamptz,
  support_snapshot jsonb not null default '{}',
  canvas jsonb not null default '{}',
  coach_hints jsonb not null default '{}',
  pushback_round int not null default 0,
  pushback_passed_at timestamptz,
  created_by text not null references users(id),
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index attempts_one_per_team_round on attempts(team_id, round_id);

create table session_progress (
  attempt_id text not null references attempts(id),
  session_key text not null,
  completed_at timestamptz not null,
  primary key (attempt_id, session_key)
);

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null references attempts(id),
  user_id text not null references users(id),
  answers jsonb not null,
  score int not null,
  at timestamptz not null
);

create table persona_messages (
  id integer generated always as identity primary key,
  attempt_id text not null references attempts(id),
  persona_key text not null,
  user_id text references users(id),
  role text not null check (role in ('learner', 'persona')),
  text text not null,
  at timestamptz not null
);

create table pushback_rounds (
  id integer generated always as identity primary key,
  attempt_id text not null references attempts(id),
  round int not null,
  section text not null,
  challenge text not null,
  defense text,
  passed boolean,
  why text,
  at timestamptz not null
);

create table simulations (
  id integer generated always as identity primary key,
  attempt_id text not null references attempts(id),
  user_id text not null references users(id),
  inputs jsonb not null,
  outputs jsonb not null,
  at timestamptz not null
);

create table booklet_views (
  id integer generated always as identity primary key,
  attempt_id text not null references attempts(id),
  user_id text not null references users(id),
  page int not null,
  at timestamptz not null
);

create table attempt_submissions (
  id text primary key,
  attempt_id text not null unique references attempts(id),
  answers jsonb not null,
  summary text not null,
  receipt_id text not null unique,
  received_at timestamptz not null,
  status text not null check (status in ('RECEIVED', 'SCREENED', 'CONFIRMED', 'RELEASED')),
  ai_status text not null default 'QUEUED',
  ai_bands jsonb,
  shortlisted boolean,
  confirmed_bands jsonb,
  confirmed_by text references users(id),
  judge_feedback text,
  owner_feedback text,
  owner_feedback_by text references users(id),
  sme_choice boolean not null default false,
  certificate_level text,
  released_at timestamptz
);

-- SME reading quota per week (TX-11)
create table owner_reads (
  owner_id text not null references users(id),
  submission_id text not null references attempt_submissions(id),
  at timestamptz not null,
  primary key (owner_id, submission_id)
);

create table stage_progress (
  user_id text not null references users(id),
  stage int not null check (stage between 1 and 7),
  support_level text not null default 'WATCH',
  consecutive_solo int not null default 0,
  last_solo_industry text,
  mastered boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, stage)
);

create table attempt_verification (
  attempt_id text not null references attempts(id),
  user_id text not null references users(id),
  position int not null,
  question text not null,
  answer text,
  explained boolean,
  why text,
  answered_at timestamptz,
  primary key (attempt_id, user_id, position)
);

create table certificates (
  id text primary key,
  attempt_id text not null references attempts(id),
  user_id text not null references users(id),
  level text not null check (level in ('participation', 'merit', 'sme_choice')),
  verify_code text not null unique,
  issued_at timestamptz not null,
  unique (attempt_id, user_id)
);
