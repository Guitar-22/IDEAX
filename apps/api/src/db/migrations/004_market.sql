-- Gate 3 · publication, search projection, organisations' requests, payments

create table publications (
  id text primary key,
  owner_id text not null references users(id),
  source_kind text not null check (source_kind in ('submission', 'attempt')),
  source_id text not null,
  title text not null,
  fields jsonb not null,
  verification_scope text not null,
  visibility text not null check (visibility in ('public', 'link', 'org')),
  opportunities text[] not null default '{}',
  status text not null,
  verified_count int not null,
  total_count int not null,
  maturity text not null,
  tier text not null,
  track text,
  created_at timestamptz not null,
  published_at timestamptz,
  withdrawn_at timestamptz
);

-- every co-author must agree before a team work goes public (AC-05)
create table publication_authors (
  publication_id text not null references publications(id),
  user_id text not null references users(id),
  consented_at timestamptz,
  primary key (publication_id, user_id)
);

-- the ONLY table Gate 3 search reads (AC-06): a projection of what owners chose to publish
create table search_index (
  publication_id text primary key references publications(id),
  visibility text not null,
  doc jsonb not null,
  body text not null,
  indexed_at timestamptz not null
);

create table search_queries (
  id integer generated always as identity primary key,
  org_id text references organizations(id),
  user_id text references users(id),
  q text not null,
  filters jsonb not null default '{}',
  results int not null,
  at timestamptz not null
);

create table shortlists (
  org_id text not null references organizations(id),
  publication_id text not null references publications(id),
  note text not null default '',
  created_by text not null references users(id),
  created_at timestamptz not null,
  primary key (org_id, publication_id)
);

create table contact_requests (
  id text primary key,
  org_id text not null references organizations(id),
  publication_id text not null references publications(id),
  requester_id text not null references users(id),
  purpose text not null,
  scope text not null,
  expires_at timestamptz not null,
  status text not null,
  disclosed jsonb,
  created_at timestamptz not null,
  decided_at timestamptz,
  unlocked_at timestamptz
);

create table engagements (
  id text primary key,
  org_id text not null references organizations(id),
  publication_id text not null references publications(id),
  requester_id text not null references users(id),
  option text not null,
  amount_satang bigint not null check (amount_satang > 0),
  status text not null,
  created_at timestamptz not null,
  decided_at timestamptz,
  paid_at timestamptz
);

create table payments (
  id text primary key,
  kind text not null check (kind in ('contact_unlock', 'idea_purchase', 'mentor_slot')),
  ref_id text not null,
  payer_org_id text references organizations(id),
  amount_satang bigint not null,
  status text not null,
  paid_at timestamptz not null,
  unique (kind, ref_id)
);

-- double entry: for every payment, debits equal credits
create table ledger_entries (
  id integer generated always as identity primary key,
  payment_id text not null references payments(id),
  account text not null,
  user_id text references users(id),
  side text not null check (side in ('debit', 'credit')),
  amount_satang bigint not null check (amount_satang >= 0),
  at timestamptz not null
);
create trigger ledger_entries_append_only before update or delete on ledger_entries
  for each row execute function forbid_mutation();
