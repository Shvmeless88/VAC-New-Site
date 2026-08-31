# Setting up this project on a second machine

Working copy of vehicleapprovalcentre.com (Vite/React frontend + `server.ts` Express
backend). See `CLAUDE.md` for how the project itself works — this file is only about
getting a new machine running and keeping two machines in sync.

GitHub (`Shvmeless88/VAC-New-Site`) is **backup and sync only** — pushing does not
deploy. Production deploys go out via `gcloud run deploy` from a local folder.

## Prerequisites

- **Node 24** (no `engines` pin in `package.json`; the original machine runs v24.18.0) — `brew install node`
- **git**
- **gcloud CLI** — only if you intend to deploy from this machine

## 1. Clone and check out the working branch

> **Active branch is `home-redesign`, not `main`.**
> A plain `git clone` checks out `main`, which may be behind. Always check out the
> working branch explicitly after cloning.

```bash
cd ~/Desktop
git clone https://github.com/Shvmeless88/VAC-New-Site.git vehicle-approval-centre
cd vehicle-approval-centre
git checkout home-redesign
```

The repo is ~2 MB, so this is fast. The HTTPS URL above prompts for a GitHub username
and personal access token on push. To use SSH instead
(`git@github.com:Shvmeless88/VAC-New-Site.git`), generate an SSH key on this machine
and add it to GitHub first — keys do not transfer between machines.

## 2. Install dependencies

```bash
npm install
```

`node_modules/` and `dist/` are gitignored and rebuild from scratch. `tsx`, `vite`, and
`typescript` are all project dependencies — nothing needs installing globally.

## 3. Copy the env files across (git cannot do this for you)

All `.env*` files are gitignored because they hold live production API credentials.
Without them the server starts, but Pipedrive, Carfax, Marketcheck, Resend, and Google
Sheets all fail.

Three files must be copied by hand from the other machine:

| File | Contents |
| --- | --- |
| `.env` | `MARKETCHECK_API_KEY` |
| `.env.production` | `VITE_FB_PIXEL_ID`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GTM_ID` |
| `.env.cloudrun` | 28 keys — Pipedrive token + field hashes, Resend, Carfax, Google Sheets service account, Google Chat webhook |

`.env.local` is empty — skip it. `.env.example` is tracked in git and arrives with the
clone, but it is a template with no real values.

**Transfer via AirDrop or a password manager.** Do not email, Slack, or text these —
they are live production credentials, and anything sent through a third-party service
is stored on that service's servers.

## 4. Authenticate gcloud (deploying machines only)

```bash
gcloud auth login
gcloud config set project gen-lang-client-0753805028
```

gcloud auth expires frequently; expect to redo this often.

## 5. Verify

```bash
npm run lint     # tsc --noEmit — should pass clean
npm run dev      # tsx server.ts
```

## Working from two machines

- **`git pull` before you start.** **Commit and push before you walk away.**
- **Stay on `home-redesign` on both machines.** Two machines on two branches is where
  merges get painful.

### Deploys — the one that can actually bite you

`gcloud run deploy --source .` deploys **your local folder**, not GitHub. Deploying
from a machine that has not pulled will ship stale code to production. Overlapping
deploys have served stale code before.

- **Always `git pull` immediately before deploying.**
- **Only one machine deploys at a time** — check with `pgrep -f "gcloud run deploy"`.
- Verify a new feature actually exists in prod before relying on it.

### Notes

- `CLAUDE.md` is committed, so Claude Code sessions on a new machine pick up the
  project guide automatically.
- `.claude/` is gitignored — local Claude config and memory are per-machine and do not
  follow you across.
- Never commit `.env*` files. They are gitignored; keep it that way.
