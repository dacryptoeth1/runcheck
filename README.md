# runcheck

Check that a hackathon project runs and matches its demo. Enter a GitHub repo URL and a demo URL to get a pass/fail result for each check.

> **Only `readme_matches` is still sample data.** It returns a fixed result for every project and is labeled "Sample data". Every other check is real.

## Run it

You need Node.js 20.9 or later, and Docker for the `repo_clones`, `installs` and `builds` checks. The user running the server must be able to run `docker`. Without Docker, `POST /api/verify` returns a `503`.

The first verification pulls `node:22-bookworm`, so it takes longer than later ones. To pull it ahead of time, run `docker pull node:22-bookworm`.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

For a production build, run `npm run build`, then `npm start`.

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

`verdict` is `pass` only if every check passes, including the sample one. The check IDs are `github_lookup`, `repo_clones`, `installs`, `builds`, `demo_loads` and `readme_matches`. `mock` is `true` for sample results. `log`, when present, holds the last 20 lines of a sandbox command's output.

Invalid input returns a `400` with `{ "error": "..." }`. If Docker isn't available, the API returns a `503` with an error starting `Sandbox unavailable:` and no check results.

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
- The container stops itself after about 8 minutes, even if the server crashes.

**The container has network access**, because cloning and installing need it. Repo code that runs during install or build can reach whatever the Docker host's network can. Docker has no flag for this, so on a server with private neighbors or a cloud metadata service, block those addresses from the Docker bridge with firewall rules. There's also no disk quota and no limit on concurrent verifications.

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

## Project layout

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Form and result cards |
| `app/api/verify/route.ts` | Input validation and combining check results |
| `lib/repoCheck.ts` | Real `github_lookup` check and README fetch |
| `lib/sandboxCheck.ts` | Real `repo_clones`, `installs` and `builds` checks in Docker |
| `lib/demoCheck.ts` | Real `demo_loads` check and address blocking |
| `lib/verdict.ts` | Types shared by the page and the API |
