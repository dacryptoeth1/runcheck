# runcheck

Check that a hackathon project runs and matches its demo. Enter a GitHub repo URL and a demo URL to get a pass/fail result for each check.

> **Only `repo_clones` and `demo_loads` are real so far.** `repo_clones` looks the repo up through the GitHub API, and `demo_loads` requests the demo URL. The other three checks return fixed sample results for every project and are labeled "Sample data". Nothing is cloned or built yet.

## Run it

You need Node.js 20.9 or later.

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
      "id": "repo_clones",
      "label": "Repo clones",
      "mock": false,
      "status": "pass",
      "detail": "Public repo, not cloned yet. Default branch: canary. Last push: 2026-11-04."
    },
    {
      "id": "installs",
      "label": "Dependencies install",
      "mock": true,
      "status": "pass",
      "detail": "Dependencies installed."
    }
  ]
}
```

`verdict` is `pass` only if every check passes, including the sample ones. The check IDs are `repo_clones`, `installs`, `builds`, `demo_loads` and `readme_matches`. `mock` is `true` for sample results.

Invalid input returns a `400` with `{ "error": "..." }`.

## How `repo_clones` works

The check calls `GET https://api.github.com/repos/{owner}/{repo}` and passes if the repo exists and is public. It doesn't run `git clone` yet.

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
| `app/api/verify/route.ts` | Input validation and mock results |
| `lib/repoCheck.ts` | Real `repo_clones` check and README fetch |
| `lib/demoCheck.ts` | Real `demo_loads` check and address blocking |
| `lib/verdict.ts` | Types shared by the page and the API |
