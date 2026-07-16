# ASP Manager — Daily Driver test release

The app remains a single-page `index.html` application using `config.js` and the existing Supabase project. This test release does not change the deployment or database architecture.

## Daily Driver update

- Fixed four-button mobile navigation below the measured blue header, including iPhone safe-area handling.
- Dashboard order: Today's Jobs, Tomorrow's Jobs, Services Due, Work Queue, Today's List.
- Customer-first Book Work flow with inline customer creation and secondary fields under More details.
- getAddress v3.1.6 inline autocomplete using the domain token from browser-safe `config.js`.
- Dedicated Book Service flow from customer and Services Due records.
- Idempotent boiler-service completion, annual service dates, reminder reset and clear next-date confirmation.
- Normalised plausible UK mobile numbers for `wa.me` links and friendly reminder messages.
- Simplified booked-job actions, with history, visits, costs, documents and waiting controls under More job details.
- Mobile-friendly field attributes and 16px inputs to prevent iPhone Safari zoom.

### Phone-test follow-up

- Coalesces overlapping refreshes and defers database work outside Supabase auth callbacks so booking cannot leave the app locked.
- Re-enables booking controls and removes the loading state on every completion/error path.
- Opens a newly saved job only after it is present in the refreshed jobs collection.
- Makes compact Tomorrow's Jobs cards tappable with a visible Open action.
- Closes an active modal before Today, Customers, Book or More navigation runs.
- Restores body scrolling and modal pointer state reliably when sheets close.
- Keeps Delete mistake inside the expanded More job details panel.

## Mobile test checklist

1. Open `asp-manager.vercel.app` in iPhone Safari, sign in, and confirm Today / Customers / Book / More remain directly below the blue header while scrolling.
2. Add the app to the Home Screen and repeat the navigation/scroll test in standalone mode, including portrait/landscape rotation.
3. Confirm dashboard order and that Tomorrow's Jobs cards are compact, Services Due is visible, and no duplicate Book Work button appears.
4. Type and select an address in New Customer, Edit Customer, Book Work, inline customer creation, and Quick Diary Entry. Confirm suggestions stay below the field and manual entry remains usable after a simulated lookup failure.
5. Book work for an existing customer and confirm address/postcode populate. Test Book now, To book, and Waiting.
6. Book a boiler service from both a customer and Services Due; confirm customer, address and boiler details, then save a date/time.
7. Complete the service and confirm one history row, updated last/next dates, incremented count, cleared reminders, active customer status, and the next service date message. Repeat the completion action and confirm no duplicate history/count.
8. Test WhatsApp with `07`, `+44`, and `0044` mobile formats on an iPhone with WhatsApp Business. Confirm landlines do not show WhatsApp.
9. Open a booked job and confirm only Navigate, Call, WhatsApp, Start/Record visit, Complete and Edit are initially visible; expand More job details for secondary controls.
10. Edit a job, preserve/change Lead source, save it, and check address, postcode, price, billing, dates and notes.
11. Focus name, address, postcode, phone, price and notes fields on iPhone; confirm there is no Safari zoom or separate typing screen and the field remains above the keyboard.
12. Switch offline, add supported queued work, restore signal, and confirm it syncs without losing customers, jobs, documents, tasks, stock, visits or costs.

## Existing database upgrades

### v0.3 Quotes & Invoices
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
