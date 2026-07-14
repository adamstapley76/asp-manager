# ASP Manager v0.1.1

Private service-customer manager for Adam Stapley Plumbing.

## Setup
1. Edit `config.js`.
2. Replace `PASTE_PROJECT_URL_HERE` with the Supabase project URL.
3. Replace `PASTE_PUBLISHABLE_KEY_HERE` with the Supabase publishable key.
4. Commit the files to GitHub.
5. Deploy through Vercel.
6. Create the first login.
7. Import the separate customer CSV once.


## v0.1.1 connection fix
- Corrected the Supabase project URL typo that caused `Failed to fetch`.
- Added clearer connection and login error messages.
- Added loading protection so repeated clicks do not send duplicate login requests.

## Test
1. Deploy these three files together (`index.html`, `config.js`, `README.md`).
2. Open the deployed site in a private/incognito window.
3. Enter the email and password used for the Supabase account.
4. If the account has not yet been created, use **Create first login** once.
