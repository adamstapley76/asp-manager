-- ASP Manager v1.0 - document email delivery and customer-view tracking

begin;

alter table public.documents
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_sent_to text,
  add column if not exists email_provider_id text,
  add column if not exists email_viewed_at timestamptz;

commit;
