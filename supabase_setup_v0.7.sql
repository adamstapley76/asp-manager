-- Secure customer-facing quote links and acceptance audit fields.

begin;

create extension if not exists pgcrypto;

alter table public.documents
  add column if not exists public_token uuid,
  add column if not exists sent_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_comment text;

update public.documents
set public_token = gen_random_uuid()
where public_token is null;

alter table public.documents
  alter column public_token set default gen_random_uuid();

create unique index if not exists documents_public_token_unique
  on public.documents (public_token)
  where public_token is not null;

commit;
