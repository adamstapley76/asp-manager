-- ASP Manager v1.3 - photo metadata for Gas Safety Certificate evidence

begin;

alter table public.gas_safety_certificate_attachments
  add column if not exists customer_id uuid references public.customers(id) on delete cascade,
  add column if not exists job_id uuid references public.jobs(id) on delete set null,
  add column if not exists category text check (category in ('Before', 'During', 'Completion', 'Certificate evidence', 'Boiler plate', 'Flue', 'Defect')),
  add column if not exists description text;

update public.gas_safety_certificate_attachments a
set customer_id = c.customer_id, job_id = c.job_id
from public.gas_safety_certificates c
where a.certificate_id = c.id and a.customer_id is null;

alter table public.gas_safety_certificate_attachments
  alter column customer_id set not null;

create index if not exists gas_safety_attachments_customer_idx on public.gas_safety_certificate_attachments (owner_id, customer_id, created_at desc);

commit;
