# runcheck

Check that a hackathon project runs and matches its demo. Enter a GitHub repo URL and a demo URL to get a pass/fail result for each check.

> **Only `demo_loads` is real so far.** It requests the demo URL. The other four checks return fixed sample results for every project and are labeled "Sample data". Nothing is cloned or built yet.

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
      "mock": true,
      "status": "pass",
      "detail": "Repository cloned."
    },
    {
      "id": "demo_loads",
      "label": "Demo loads",
      "mock": false,
      "status": "pass",
      "detail": "HTTP 200 in 342 ms."
    }
  ]
}
```

`verdict` is `pass` only if every check passes, including the sample ones. The check IDs are `repo_clones`, `installs`, `builds`, `demo_loads` and `readme_matches`. `mock` is `true` for sample results.

Invalid input returns a `400` with `{ "error": "..." }`.

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
| `lib/demoCheck.ts` | Real `demo_loads` check and address blocking |
| `lib/verdict.ts` | Types shared by the page and the API |
