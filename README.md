# runcheck

Check that a hackathon project runs and matches its demo. Enter a GitHub repo URL and a demo URL to get a pass/fail result for each check.

> **`readme_matches` is a keyword-based heuristic, not a perfect check.** It compares words, so it can't tell whether a demo really does what its README says. Every other check tests the project directly.

## Run it

You need Node.js 20.9 or later, and Docker for the `repo_clones`, `installs` and `builds` checks. The user running the server must be able to run `docker`. Without Docker, `POST /api/verify` returns a `503`.

The first verification pulls `node:22-bookworm`, so it takes longer than later ones. To pull it ahead of time, run `docker pull node:22-bookworm`.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

For a production build, run `npm run build`, then `npm start`. To deploy to a server, follow [DEPLOY.md](DEPLOY.md).

### Optional: GitHub token

A token raises GitHub's rate limit from 60 to 5,000 requests per hour. To use one, create `.env.local` in the project root and restart the server:

```bash
GITHUB_TOKEN=your_token_here
```

Use a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to public repositories only. A token with private repo access could reveal that those repos exist. `.env.local` is ignored by git, so the token isn't committed.

## API

`POST /api/verify`

```bash
curl -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/vercel/next.js","demoUrl":"https://nextjs.org"}'
```

The response looks like this (`checks` is shortened to two entries):

```json
{
  "verdict": "fail",
  "repoUrl": "https://github.com/vercel/next.js",
  "demoUrl": "https://nextjs.org/",
  "checks": [
    {
      "id": "github_lookup",
      "label": "GitHub lookup",
      "mock": false,
      "status": "pass",
      "detail": "Public repo. Default branch: canary. Last push: 2026-11-04."
    },
    {
      "id": "repo_clones",
      "label": "Repo clones",
      "mock": false,
      "status": "pass",
      "detail": "git clone finished without errors.",
      "log": "Cloning into '/home/node/app'..."
    }
  ]
}
```

`verdict` is `pass` only if every check passes, and the page shows "Verified" only in that case. The check IDs are `github_lookup`, `repo_clones`, `installs`, `builds`, `demo_loads` and `readme_matches`. `mock` is always `false` now that every check is real. `log`, when present, holds the last 20 lines of a sandbox command's output.

Invalid input returns a `400` with `{ "error": "..." }`. If Docker isn't available, the API returns a `503` with an error starting `Sandbox unavailable:` and no check results.

Two limits apply, and both responses include a `Retry-After` header:

- Only 2 verifications run at once. Extra requests get a `503` saying runcheck is busy. They aren't queued.
- Each IP address can start 5 verifications per hour. Further requests get a `429`. Rejected requests and `Sandbox unavailable` errors don't count toward the 5.

The limits are held in memory, so they reset when the server restarts, and the server must run as a single process.

A verification can take several minutes, and the request stays open until it finishes. If the server is behind a reverse proxy, raise the proxy's response timeout to at least 8 minutes.

## How `repo_clones`, `installs` and `builds` work

Each verification starts one throwaway `node:22-bookworm` container and runs these steps in it:

| Step | Check | Time limit |
| --- | --- | --- |
| `git clone --depth 1` | `repo_clones` | 60 seconds |
| `npm install`, or `pnpm install` / `yarn install` if `pnpm-lock.yaml` / `yarn.lock` exists | `installs` | 180 seconds |
| The `build` script from `package.json` | `builds` | 180 seconds |

- If a step fails or times out, the later steps are skipped and reported as failed. A step that times out kills the container.
- A project with no `build` script passes `builds`, and the detail says there was nothing to build.
- A repo with no `package.json` at its root fails `installs`.
- The container runs as the non-root `node` user with `--rm`, a unique name, `--memory=1g`, `--cpus=1`, `--pids-limit=256`, `--cap-drop=ALL` and `--security-opt no-new-privileges`. No host folders or Docker socket are mounted, and no server environment variables are passed in.
- The container's filesystem is read-only. It can only write to two tmpfs mounts: `/home/node` (768 MB, which holds the clone, `node_modules` and package caches) and `/tmp` (128 MB). Nothing it writes reaches the host's disk.
- tmpfs contents count against the 1 GB memory limit, so files and running processes share it. A large project can run out of memory during its build, and the check then reports exit code 137.
- The container stops itself after about 8 minutes, even if the server crashes.

**The container has network access**, because cloning and installing need it. Docker has no flag to limit that to the public internet, so [DEPLOY.md](DEPLOY.md) sets up the firewall rules that block private addresses. It uses the public DNS servers `1.1.1.1` and `8.8.8.8` so that those rules don't break name lookups.

## How `github_lookup` works

The check calls `GET https://api.github.com/repos/{owner}/{repo}` and passes if the repo exists and is public.

- The check has a 10 second limit, which covers both the repo and README requests.
- It fails with a specific message if the repo is not found or private, if GitHub's rate limit is reached, or if GitHub can't be reached.
- GitHub returns `404` for private repos the request can't access, so those two cases share one message.
- Each verification uses 2 GitHub API requests. Without a token, GitHub allows 60 per hour per IP address.
- It also fetches the README and keeps the text in memory for the current request, ready for `readme_matches`. The text isn't stored or returned. A missing README doesn't fail the check.

## How `demo_loads` works

The check sends a `GET` to the demo URL and passes only if the final status is 2xx.

- It follows up to 5 redirects, with a 10 second limit on the whole check.
- The load time runs until the final response's headers arrive. The body isn't downloaded, so a page that returns 200 but renders blank still passes.
- Private and internal addresses are blocked, including `localhost`, `127.x`, `10.x`, `172.16.x`–`172.31.x`, `192.168.x`, `169.254.x` and their IPv6 equivalents.
- The block also applies to every redirect and to the IP addresses a hostname resolves to, checked when the connection is made.

## How `readme_matches` works

This is a keyword-based heuristic, and the check's label and detail say so. It passes if at least 40% of the README's key terms appear on the demo page, and the detail lists the matched and missing terms.

- Key terms come from the README's headings, bold text, list items under a features-style heading, and code-formatted names. Up to 30 are compared.
- Common section titles such as "Installation" and code that wouldn't appear on a website, such as commands, file names and environment variables, are ignored.
- A term matches if all of its words appear on the page, in any order and ignoring case. Common words such as "the" don't need to match.
- The demo page is requested separately from `demo_loads`, with the same address blocking on every redirect and its own 10 second limit. Only the first 2 MB of HTML is read.
- The check fails if there's no README, if no key terms are found, or if the demo page can't be read as HTML.
- JavaScript isn't run, so a page that renders all of its content in the browser will usually fail. When the HTML has very little text, the detail says so. A page can also pass just by mentioning the right words.

## Project layout

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Form and result cards |
| `app/api/verify/route.ts` | Input validation and combining check results |
| `lib/repoCheck.ts` | Real `github_lookup` check and README fetch |
| `lib/sandboxCheck.ts` | Real `repo_clones`, `installs` and `builds` checks in Docker |
| `lib/limits.ts` | Concurrency limit and per-IP rate limit |
| `server.mjs` | Production server, which records each client's real IP address |
| `lib/demoCheck.ts` | Real `demo_loads` check, demo page fetch and address blocking |
| `lib/readmeCheck.ts` | `readme_matches` keyword heuristic |
| `lib/verdict.ts` | Types shared by the page and the API |
