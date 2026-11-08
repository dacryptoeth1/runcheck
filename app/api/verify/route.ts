import { checkDemoLoads, demoUrlError } from "@/lib/demoCheck";
import { admitVerification } from "@/lib/limits";
import { checkRepo, parseGitHubRepo } from "@/lib/repoCheck";
import { runSandboxChecks, SandboxUnavailableError } from "@/lib/sandboxCheck";
import type { Check, Verdict, VerifyError } from "@/lib/verdict";

// Fixed sample data until this check runs for real.
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
  const repo = repoUrl && parseGitHubRepo(repoUrl);
  if (!repoUrl || !repo) {
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

  // server.mjs overwrites this header with the socket address.
  const clientIp = request.headers.get("x-forwarded-for") ?? "unknown";
  const admission = admitVerification(clientIp);
  if (!admission.admitted) {
    return Response.json({ error: admission.error } satisfies VerifyError, {
      status: admission.status,
      headers: { "Retry-After": String(admission.retryAfterSeconds) },
    });
  }

  // repoResult.readme holds the README text for the real readme_matches check.
  // It stays on the server and isn't included in the response.
  try {
    const [repoResult, sandboxChecks, demoCheck] = await Promise.all([
      checkRepo(repo),
      runSandboxChecks(repo),
      checkDemoLoads(demoUrl),
    ]);

    const checks: Check[] = [
      repoResult.check,
      ...sandboxChecks,
      demoCheck,
      MOCK_README_CHECK,
    ];

    const result: Verdict = {
      verdict: checks.every((check) => check.status === "pass")
        ? "pass"
        : "fail",
      repoUrl: repoUrl.href,
      demoUrl: demoUrl.href,
      checks,
    };

    return Response.json(result);
  } catch (error) {
    if (error instanceof SandboxUnavailableError) {
      admission.refund();
      return Response.json({ error: error.message } satisfies VerifyError, {
        status: 503,
      });
    }
    throw error;
  } finally {
    admission.release();
  }
}
