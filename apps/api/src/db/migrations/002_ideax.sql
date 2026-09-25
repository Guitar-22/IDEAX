-- Gate 1 + Gate 2 (coursework) · IDEAX classroom, submissions, AI proposals, human review, release

create table rubrics (
  id text primary key,
  name text not null,
  pass_mark double precision not null,
  -- null = the source rubric gives no weights, so every item counts equally (AC-04)
  weights jsonb,
  source text not null
);

create table rubric_criteria (
  id text primary key,
  rubric_id text not null references rubrics(id),
  no text not null,
  name text not null,
  purpose text not null,
  th text not null,
  position int not null
);

create table rubric_items (
  id text primary key,
  rubric_id text not null references rubrics(id),
  criterion_id text not null references rubric_criteria(id),
  no text not null,
  text text not null,
  hints jsonb not null default '{}',
  position int not null,
  unique (rubric_id, no)
);

create table courses (
  id text primary key,
  name text not null,
  code text not null,
  instructor_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table enrollments (
  course_id text not null references courses(id),
  user_id text not null references users(id),
  role text not null default 'student' check (role in ('student', 'marker')),
  primary key (course_id, user_id)
);

create table assignments (
  id text primary key,
  course_id text not null references courses(id),
  rubric_id text not null references rubrics(id),
  title text not null,
  brief text not null,
  due_at timestamptz not null,
  min_words int not null,
  max_words int not null,
  requires_disclosure boolean not null default true,
  -- IDEAX verification mode: copy/paste limits + understanding questions (plan p.51)
  verification boolean not null default false,
  case_id text,
  created_at timestamptz not null default now()
);

create table ai_disclosures (
  id uuid primary key default gen_random_uuid(),
  assignment_id text not null references assignments(id),
  student_id text not null references users(id),
  tool text not null,
  part text not null,
  at timestamptz not null
);

create table precheck_runs (
  id uuid primary key default gen_random_uuid(),
  assignment_id text not null references assignments(id),
  student_id text not null references users(id),
  content_hash text not null,
  result jsonb not null,
  at timestamptz not null
);

create table submissions (
  id text primary key,
  assignment_id text not null references assignments(id),
  student_id text not null references users(id),
  status text not null,
  created_at timestamptz not null,
  unique (assignment_id, student_id)
);

-- every version is kept; a resubmission never overwrites the previous file
create table submission_versions (
  id text primary key,
  submission_id text not null references submissions(id),
  version_no int not null,
  content text not null,
  sha256 text not null,
  word_count int not null,
  receipt_id text not null unique,
  received_at timestamptz not null,
  revision_note text,
  unique (submission_id, version_no)
);

create table analysis_runs (
  id text primary key,
  submission_version_id text not null references submission_versions(id),
  status text not null,
  attempts int not null default 0,
  model text,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table anchors (
  id text primary key,
  submission_version_id text not null references submission_versions(id),
  code text not null,
  loc text,
  start_offset int not null,
  end_offset int not null,
  hash text not null,
  unique (submission_version_id, code)
);

create table item_proposals (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id text not null references analysis_runs(id),
  submission_version_id text not null references submission_versions(id),
  item_no text not null,
  grade text,
  kind text not null,
  why text not null,
  feedback text not null default '',
  anchor_codes text[] not null default '{}',
  reason_code text
);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  submission_version_id text not null references submission_versions(id),
  item_no text not null,
  status text not null,
  grade text,
  ai_grade text,
  reason text not null default '',
  ann text[] not null default '{}',
  row_version int not null default 1,
  decided_by text references users(id),
  decided_at timestamptz,
  unique (submission_version_id, item_no)
);

create table review_decisions (
  id uuid primary key default gen_random_uuid(),
  submission_version_id text not null references submission_versions(id),
  item_nos text[] not null,
  action text not null,
  prev text not null,
  next text not null,
  reason text not null,
  actor_id text not null references users(id),
  at timestamptz not null
);

-- what the learner sees; immutable once written (AC-12)
create table feedback_releases (
  id uuid primary key default gen_random_uuid(),
  submission_version_id text not null references submission_versions(id),
  release_version int not null,
  mode text not null check (mode in ('revise', 'finalize')),
  note text not null default '',
  snapshot jsonb not null,
  released_by text not null references users(id),
  released_at timestamptz not null,
  unique (submission_version_id, release_version)
);
create trigger feedback_releases_append_only before update or delete on feedback_releases
  for each row execute function forbid_mutation();

create table verification_questions (
  id uuid primary key default gen_random_uuid(),
  submission_version_id text not null references submission_versions(id),
  position int not null,
  question text not null,
  answer text,
  explained boolean,
  why text,
  answered_at timestamptz,
  unique (submission_version_id, position)
);

-- IDEAX: learners use AI inside the platform so the process is visible (TX-19)
create table ai_chat_messages (
  id integer generated always as identity primary key,
  assignment_id text not null references assignments(id),
  student_id text not null references users(id),
  role text not null check (role in ('student', 'ai')),
  text text not null,
  at timestamptz not null
);
