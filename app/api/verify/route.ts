import { checkDemoLoads, demoUrlError } from "@/lib/demoCheck";
import type { Check, Verdict, VerifyError } from "@/lib/verdict";

// Fixed sample data until these checks run for real.
const MOCK_BUILD_CHECKS: Check[] = [
  {
    id: "repo_clones",
    label: "Repo clones",
    mock: true,
    status: "pass",
    detail: "Repository cloned.",
  },
  {
    id: "installs",
    label: "Dependencies install",
    mock: true,
    status: "pass",
    detail: "Dependencies installed.",
  },
  {
    id: "builds",
    label: "Project builds",
    mock: true,
    status: "pass",
    detail: "Build finished without errors.",
  },
];

const MOCK_README_CHECK: Check = {
  id: "readme_matches",
  label: "README matches",
  mock: true,
  status: "fail",
  detail: "README describes a feature the demo doesn't show.",
};

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
  if (!demoUrl) {
    return badRequest("Enter a demo URL starting with http:// or https://.");
  }
  const demoError = demoUrlError(demoUrl);
  if (demoError) {
    return badRequest(demoError);
  }

  const checks: Check[] = [
    ...MOCK_BUILD_CHECKS,
    await checkDemoLoads(demoUrl),
    MOCK_README_CHECK,
  ];

  const result: Verdict = {
    verdict: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    repoUrl: repoUrl.href,
    demoUrl: demoUrl.href,
    checks,
  };

  return Response.json(result);
}
