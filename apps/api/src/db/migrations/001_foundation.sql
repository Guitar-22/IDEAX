-- Gate 0 · shared foundation: identity, consent, audit, decision trace, diagnostics

create table organizations (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('sme', 'community', 'company', 'university', 'platform')),
  domain_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table users (
  id text primary key,
  name text not null,
  email text not null unique,
  role text not null,
  org_id text references organizations(id),
  birth_year int,
  institution text,
  province text,
  faculty text,
  phone text,
  guardian_phone text,
  student_card_verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- consent is a ledger: the current state of (user, code) is its latest row
create table consent_records (
  id uuid primary key default gen_random_uuid(),
  seq integer generated always as identity,
  user_id text not null references users(id),
  code text not null,
  text_version text not null,
  action text not null check (action in ('given', 'withdrawn')),
  channel text not null,
  at timestamptz not null default now()
);
create index consent_records_user on consent_records(user_id, code, seq desc);

create table guardian_otps (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id),
  phone text not null,
  code text not null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  attempts int not null default 0
);

create table audit_log (
  id integer generated always as identity primary key,
  at timestamptz not null default now(),
  correlation_id text not null,
  actor_id text,
  role text,
  object text not null,
  prev text not null default '-',
  next text not null default '-',
  reason text not null default '-'
);

create table trace_events (
  id integer generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id text,
  team_id text,
  context_kind text,
  context_id text,
  case_id text,
  journey_step text,
  stage int,
  support_level text,
  type text not null,
  payload jsonb not null default '{}',
  correlation_id text not null
);
create index trace_events_context on trace_events(context_kind, context_id, at);
create index trace_events_actor on trace_events(actor_id, type);

create table diagnostics (
  id integer generated always as identity primary key,
  at timestamptz not null default now(),
  subject_kind text not null,
  subject_id text not null,
  kind text not null,
  detail text not null,
  correlation_id text
);

-- append-only: nobody may rewrite history (docs/APP_FLOW.md §10, mockup "บันทึกระบบ")
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table: %', TG_TABLE_NAME;
end
$$;
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function forbid_mutation();
create trigger trace_events_append_only before update or delete on trace_events
  for each row execute function forbid_mutation();
create trigger consent_records_append_only before update or delete on consent_records
  for each row execute function forbid_mutation();
