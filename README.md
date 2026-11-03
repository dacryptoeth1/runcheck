# runcheck

Check that a hackathon project runs and matches its demo. Enter a GitHub repo URL and a demo URL to get a pass/fail result for each check.

> **The results are mock data.** `/api/verify` validates the URLs, then returns the same fixed sample results for every project. Nothing is cloned, built or loaded yet.

## Run it

You need Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

For a production build, run `npm run build`, then `npm start`.

## API

`POST /api/verify`

```bash
curl -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/vercel/next.js","demoUrl":"https://nextjs.org"}'
```

The response looks like this (`checks` is shortened to one entry):

```json
{
  "mock": true,
  "verdict": "fail",
  "repoUrl": "https://github.com/vercel/next.js",
  "demoUrl": "https://nextjs.org/",
  "checks": [
    {
      "id": "repo_clones",
      "label": "Repo clones",
      "status": "pass",
      "detail": "Sample result: repository cloned."
    }
  ]
}
```

`verdict` is `pass` only if every check passes. The check IDs are `repo_clones`, `installs`, `builds`, `demo_loads` and `readme_matches`.

Invalid input returns a `400` with `{ "error": "..." }`.

## Project layout

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Form and result cards |
| `app/api/verify/route.ts` | Input validation and mock results |
| `lib/verdict.ts` | Types shared by the page and the API |
