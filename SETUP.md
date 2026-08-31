# Working on this project from two machines

Working copy of vehicleapprovalcentre.com (Vite/React frontend + `server.ts` Express
backend). See `CLAUDE.md` for how the project itself works — this file is only about
getting a machine set up and keeping two machines in sync.

Current setup: **MacBook** (home) and **Windows desktop** (office). GitHub
(`Shvmeless88/VAC-New-Site`) is the sync point between them. Pushing to GitHub does
**not** deploy — production deploys go out via `gcloud run deploy` from a local folder.

---

## First-time setup on a new machine

### 1. Install the tools

| Tool | macOS | Windows (PowerShell) |
| --- | --- | --- |
| Git | preinstalled, or `brew install git` | [git-scm.com/downloads/win](https://git-scm.com/downloads/win) |
| Node 24 | `brew install node` | `winget install OpenJS.NodeJS` or [nodejs.org](https://nodejs.org) |
| Google Cloud SDK | `brew install --cask google-cloud-sdk` | [cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install) |
| Claude Code (optional) | `curl -fsSL https://claude.ai/install.sh \| bash` | `irm https://claude.ai/install.ps1 \| iex` |

No `engines` pin in `package.json`; the MacBook runs Node v24.18.0 and the Windows
desktop v24.19.0 — any Node 24 is fine.

**Windows only — two snags worth knowing up front:**

*npm blocked by execution policy.* PowerShell refuses to run `npm.ps1` by default
(`running scripts is disabled on this system`). Fix once, no admin needed:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

*Claude Code not on PATH.* The installer may not add itself. Fix once, then open a
**new** terminal (PATH changes don't reach already-open windows):

```powershell
[Environment]::SetEnvironmentVariable("PATH", "$env:USERPROFILE\.local\bin;" + [Environment]::GetEnvironmentVariable("PATH","User"), "User")
```

### 2. Clone and check out the working branch

> **The active branch is `home-redesign`.** Check it out explicitly after cloning.

macOS:
```bash
cd ~/Desktop
git clone https://github.com/Shvmeless88/VAC-New-Site.git vehicle-approval-centre
cd vehicle-approval-centre
git checkout home-redesign
```

Windows:
```powershell
cd $HOME
git clone https://github.com/Shvmeless88/VAC-New-Site.git vehicle-approval-centre
cd vehicle-approval-centre
git checkout home-redesign
```

The repo is ~2 MB. First push over HTTPS prompts for a GitHub login; on Windows, Git
Credential Manager opens a browser and remembers it.

**Do not put this folder in OneDrive or iCloud Drive.** `npm install` creates tens of
thousands of files in `node_modules`; a syncing folder will thrash and cause file-lock
errors during builds. `C:\Users\<you>\vehicle-approval-centre` is a good Windows home.

### 3. Install dependencies

```
npm install
```

`node_modules/` and `dist/` are gitignored and rebuild per machine. Re-run `npm install`
after any pull that changes `package.json`, or the typecheck fails on types you don’t have
yet.

### 4. Copy the env files across (git cannot do this for you)

All `.env*` files are gitignored because they hold live production API credentials.
Without them the server starts, but Pipedrive, Carfax, Marketcheck, Resend, and Google
Sheets all fail.

Three files must be moved by hand from a machine that already has them:

| File | Contents |
| --- | --- |
| `.env` | `MARKETCHECK_API_KEY` |
| `.env.production` | `VITE_FB_PIXEL_ID`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GTM_ID` |
| `.env.cloudrun` | 28 keys — Pipedrive token + field hashes, Resend, Carfax, Google Sheets service account, Google Chat webhook |

`.env.local` is empty — skip it. `.env.example` is tracked in git and arrives with the
clone, but holds no real values.

They're hidden files, so reveal them first:
- **macOS Finder:** `Cmd + Shift + .`
- **Windows File Explorer:** View → Show → Hidden items

Move them with **OneDrive, a USB stick, or AirDrop (Mac→Mac)**. Do not email, Slack, or
text them — these are live production credentials, and anything sent through a
third-party service is stored on that service's servers.

### 5. Authenticate gcloud (only on machines that deploy)

```
gcloud auth login
gcloud config set project gen-lang-client-0753805028
gcloud config set run/region us-west1
```

Auth expires frequently — expect to redo the login often. Note that `gcloud auth list`
can show an account while the tokens are already dead; the real test is an API call:

```
gcloud run services describe vehicle-approval-centre --region us-west1
```

### 6. Verify

```
npm run lint     # tsc --noEmit — passes clean; typecheck only, it is not eslint
npm run build    # vite build — Vite does NOT typecheck, so this can pass while lint fails
npm run dev      # tsx server.ts
```

If `npm run lint` reports `Cannot find namespace 'React'`, your `node_modules` predates
2026-08-31, when `@types/react` / `@types/react-dom` were added as devDependencies (they
had never been declared, so the typecheck failed on any clean install). Re-run `npm install`.

---

## Day-to-day: switching between machines

- **`git pull` before you start.** **Commit and push before you walk away.**
- **Stay on `home-redesign` on both machines.** Two machines on two branches is where
  merges get painful.
- If you forget to push and later pull elsewhere, you won't lose work — but you will
  get a merge to resolve. Pushing before you leave avoids it entirely.

### Deploys — the one that can actually bite you

`gcloud run deploy --source .` deploys **your local folder**, not GitHub. Deploying from
a machine that hasn't pulled will ship stale code to production. This has happened
before.

- **Always `git pull` immediately before deploying.**
- **Only one machine deploys at a time** (`pgrep -f "gcloud run deploy"` on macOS,
  `Get-Process | Where-Object {$_.Name -like "*gcloud*"}` on Windows).
- Verify a new feature actually exists in prod before relying on it.

### Notes

- `CLAUDE.md` is committed, so Claude Code sessions on either machine pick up the
  project guide automatically.
- `.claude/` is gitignored — local Claude config, settings, and conversation history are
  per-machine and do **not** follow you between them. A Claude Code session started on
  one machine knows nothing about work done on the other; only what's committed carries
  across.
- Never commit `.env*` files. They're gitignored; keep it that way.
