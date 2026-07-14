# ASP Manager v0.3 — Quotes & Invoices

This release builds on the working v0.2 Customers + Jobs app.

## New in v0.3
- Quotes and invoices linked to customers and jobs.
- Multiple line items with quantity and ex-VAT unit price.
- Automatic subtotal, VAT and total calculation.
- Draft, sent, accepted, paid, overdue and void workflows.
- One-click conversion from an accepted quote to an invoice.
- Printable customer copy that can be saved as PDF from the browser.
- Quote and invoice history inside customer and job records.
- Dashboard counts for waiting quotes and unpaid invoices.

## Upgrade from v0.2
1. In the existing Supabase project, open **SQL Editor**.
2. Select **New snippet**.
3. Paste all of `supabase_setup_v0.3.sql` and press **Run** once.
4. Replace the existing GitHub files with the files in this ZIP.
5. Let Vercel redeploy, then refresh the app.

Do not create a new Supabase project. Existing customers and jobs are preserved.

## Fresh installation
Run `supabase_setup_v0.2.sql` first, then `supabase_setup_v0.3.sql`.
