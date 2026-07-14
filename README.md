# ASP Manager v0.2 — Customers + Jobs

Private customer, service and job manager for Adam Stapley Plumbing.

## What is new
- New Dashboard with active customer, upcoming job, quote and service KPIs.
- New Jobs section linked to customer records.
- Add, edit, book, quote, complete and delete mistaken/duplicate jobs.
- Job dates, times, addresses, notes, quoted price and invoice number.
- Recent job history displayed inside each customer record.
- Improved customer creation and editing.
- Existing Supabase login, service history and CSV import retained.

## Deploy
1. Keep the supplied `config.js` with the working Supabase URL and publishable key.
2. In Supabase, open **SQL Editor**.
3. Create a new query and paste all of `supabase_setup_v0.2.sql`.
4. Press **Run** once.
5. Replace the existing GitHub files with:
   - `index.html`
   - `config.js`
   - `README.md`
   - `supabase_setup_v0.2.sql`
6. Let Vercel redeploy.
7. Open the app in an incognito/private window and sign in.

If the SQL has not been run yet, the app will show a yellow setup notice. Customer and service features will continue to work, but Jobs will remain disabled until the table is created.
