# Scene Studio on Hostinger

## Application

Deploy this repository as a Hostinger Business **Node.js Web App**. In the GitHub import wizard choose the `codex/hostinger-studio-migration` branch, the **Other** framework preset, npm, build command `npm run build`, and entry file `server/index.mjs`; leave output directory empty. Hostinger installs dependencies separately. The app listens on `PORT` supplied by Hostinger and serves the Vite build through Express. Use Node.js 22 or newer.

Do not use the GitHub Pages build for the hosted version: it has no login, private storage, or server queue. Keep the current Pages site untouched until the new site is verified and a rollback is available.

## One-time environment setup

Create a Hostinger MySQL database and user. Set the variables from `.env.example` in hPanel; never put their real values in this repository or a `VITE_` variable. `APP_DATA_DIR` must be an absolute private directory **outside** Hostinger's deployment-managed build directory and outside `public_html`. Back up both MySQL and this directory together. The service refuses to start in production if the directory is inside this repository or a known deployment directory.

Generate each password hash with `npm run hash-password` and enter the password at the hidden prompt (do not put it on the command line). Put the resulting `scrypt:...` value in `APP_USERS_JSON`, for example `{"owner":{"passwordHash":"scrypt:...","admin":true}}`. Use a random `SESSION_SECRET` of at least 32 characters and keep it stable across redeploys. Rotating it logs everyone out and makes queued browser-fallback keys unreadable. Admin accounts can see aggregate usage. All accounts share project and task data.

`OPENAI_API_KEY` and `GEMINI_API_KEY` are optional server secrets. If a provider's env key is absent, a logged-in user can supply that provider's key in the site's settings window. It is sent only to this server and encrypted while its job is pending, then removed from the database when the job finishes. Require HTTPS before using browser keys.

For the current temporary Hostinger domain, set `APP_ORIGIN=https://floralwhite-cheetah-150627.hostingersite.com`. Change it to `https://studio.lifelightenup.com` when binding the final domain. The origin setting protects POST requests and must not include a trailing slash. Ignore/remove Hostinger's suggested `VITE_GEMINI_PROXY_URL`; the hosted app does not use a browser-side proxy address.

## Release sequence

1. Deploy an isolated Git branch to Hostinger's temporary application domain. Verify login, MySQL tables, image upload/read, a real OpenAI or Gemini job, result reload, and access denial without a session.
2. Redeploy the same branch and confirm the MySQL records and `APP_DATA_DIR` images remain readable. Restart during a queued test job and confirm recovery. A request already running upstream is marked interrupted, not blindly resent, because its outcome is uncertain and resending could charge twice. Check the 30-day expiry indication with a test record.
3. In Aliyun DNS, add **only** the `studio` record specified by Hostinger. Do not edit the apex (`lifelightenup.com`), `www`, MX, TXT, or other records. Bind `studio.lifelightenup.com` in Hostinger, enable SSL, and change `APP_ORIGIN`.
4. Test HTTPS, login, all ten primary tools, private downloads, and the unaffected main site. Only then stop the old GitHub Pages publishing workflow. Keep the previous deployed commit as rollback.

Do not treat a successful build alone as release approval. The browser-local project cache is intentionally not imported into the shared server workspace.

## Data lifecycle

Generated image assets, raw AI requests, and raw AI responses are deleted after 30 days. Job text, status, and usage counts remain. Uploaded source images referenced by a saved project are retained; unreferenced uploaded source files are eligible for cleanup after 30 days. Cleanup runs on startup and daily. A hosted application that is not running cannot clean on schedule, so monitor process uptime and storage consumption.

## Local smoke test

For UI smoke tests without MySQL only, set `ALLOW_MEMORY_STORE=1` and `NODE_ENV=development` alongside `APP_USERS_JSON` and `SESSION_SECRET`. Set `APP_ORIGIN` to the exact Vite origin (for example `http://127.0.0.1:5173`), then run `npm run dev:server` and `npm run dev`. This store is non-persistent and is refused in production. Run `npm test`, `npm run test:server`, `npm run typecheck`, and `npm run build` before a release.
