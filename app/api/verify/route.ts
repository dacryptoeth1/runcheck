import type { Check, Verdict, VerifyError } from "@/lib/verdict";

// Fixed sample data, including one failure so both card states are visible.
const MOCK_CHECKS: Check[] = [
  {
    id: "repo_clones",
    label: "Repo clones",
    status: "pass",
    detail: "Sample result: repository cloned.",
  },
  {
    id: "installs",
    label: "Dependencies install",
    status: "pass",
    detail: "Sample result: dependencies installed.",
  },
  {
    id: "builds",
    label: "Project builds",
    status: "pass",
    detail: "Sample result: build finished without errors.",
  },
  {
    id: "demo_loads",
    label: "Demo loads",
    status: "pass",
    detail: "Sample result: demo URL responded with 200.",
  },
  {
    id: "readme_matches",
    label: "README matches",
    status: "fail",
    detail: "Sample result: README describes a feature the demo doesn't show.",
  },
];

function parseUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function isGitHubRepoUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    /^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
  );
}

function isWebUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

function badRequest(error: string) {
  return Response.json({ error } satisfies VerifyError, { status: 400 });
}

export async function POST(request: Request) {
  let body: { repoUrl?: unknown; demoUrl?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }

  const repoUrl = parseUrl(body?.repoUrl);
  if (!repoUrl || !isGitHubRepoUrl(repoUrl)) {
    return badRequest(
      "Enter a GitHub repo URL like https://github.com/owner/repo.",
    );
  }

  const demoUrl = parseUrl(body?.demoUrl);
  if (!demoUrl || !isWebUrl(demoUrl)) {
    return badRequest("Enter a demo URL starting with http:// or https://.");
  }

  const result: Verdict = {
    mock: true,
    verdict: MOCK_CHECKS.every((check) => check.status === "pass")
      ? "pass"
      : "fail",
    repoUrl: repoUrl.href,
    demoUrl: demoUrl.href,
    checks: MOCK_CHECKS,
  };

  return Response.json(result);
}
