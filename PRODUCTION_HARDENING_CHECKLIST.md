# ASP Manager production-hardening checklist

This checklist is for the production-hardening branch only. It does not authorise a deployment or merge.

## Before applying the database migration

1. In ASP Manager, open **More → Data protection → Export Business Data**.
2. Save the downloaded JSON file in iCloud Drive, Google Drive, or another secure location.
3. Check **More → System health** shows no pending sync changes.
4. Review `supabase_setup_production_hardening.sql` in Supabase SQL Editor before running it.
5. Confirm the branch has passed the manual smoke test below.

## What the hardening migration changes

- Adds reversible archive fields to customers, jobs and quotes/invoices.
- Adds an owner-scoped, append-only audit-events table.
- Adds a partial unique index so a quote or invoice number cannot be duplicated for the same owner and document type.

It does not delete, rewrite, or import existing business data.

## Restore process

- For a customer, job, quote or invoice archived in ASP Manager, use **More → Archived records → Restore**.
- The downloaded business-data export is a recovery reference, including data and available file paths/metadata. It intentionally does not overwrite live data automatically.
- If a wider recovery is ever needed, first create a fresh export and restore into a reviewed copy of the data. Do not bulk import over the live database without checking linked records and document numbers.

## File recovery note

The export records file metadata and storage paths. It does not embed original photos, PDFs or other binary files, so storage retention and Supabase project backups remain important.

## Manual smoke test

Run this on a test customer, not a live job:

1. Create and edit a customer.
2. Create a job, book it, start and finish a visit, and complete it.
3. Create a quote, mark it sent, and convert it to an invoice.
4. Record a deposit or invoice payment and verify its QuickBooks sync status.
5. Archive and restore a test job and a test draft document.
6. Turn on airplane mode, create one safe test item, restore signal, and confirm it syncs once.
7. Export Business Data and confirm the JSON opens and includes the expected record groups.
8. Check the app on iPhone-sized and desktop layouts.

## Rollback

- Do not run a database rollback by deleting records or columns.
- If the front-end change causes a problem, redeploy the previously known-good application build.
- If a migration review identifies an issue before it is applied, do not run the migration; correct it on this branch and repeat the smoke test.
- For an already-applied migration, create a forward-fix migration after taking a current export. Preserve audit and financial records.
