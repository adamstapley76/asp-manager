-- Prevent a historical Invoice2go document being brought into the live workspace twice.
-- The source marker is kept in document notes but is hidden from customer-facing views.
create unique index if not exists documents_invoice2go_source_unique
  on public.documents ((substring(notes from '\[Invoice2go source: ([^]]+)\]')))
  where notes ~ '\[Invoice2go source: ';
