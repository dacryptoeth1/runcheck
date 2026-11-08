import type { Check } from "@/lib/verdict";

const TIMEOUT_MS = 10_000;
const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "runcheck",
};

export type GitHubRepo = { owner: string; repo: string };

export type RepoCheckResult = {
  check: Check;
  /** README text, or null if there isn't one or it couldn't be read. */
  readme: string | null;
};

/** Returns the owner and repo from a GitHub repo URL, or null if it isn't one. */
export function parseGitHubRepo(url: URL): GitHubRepo | null {
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;

  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function apiUrl({ owner, repo }: GitHubRepo, path = ""): string {
  const name = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return `https://api.github.com/repos/${name}${path}`;
}

function getFromApi(url: string, signal: AbortSignal): Promise<Response> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers = token
    ? { ...API_HEADERS, Authorization: `Bearer ${token}` }
    : API_HEADERS;
  return fetch(url, { headers, signal, cache: "no-store" });
}

function isRateLimited(response: Response): boolean {
  return (
    (response.status === 403 || response.status === 429) &&
    (response.headers.get("x-ratelimit-remaining") === "0" ||
      response.headers.has("retry-after"))
  );
}

function rateLimitDetail(headers: Headers): string {
  const retryAfter = Number(headers.get("retry-after"));
  const reset = Number(headers.get("x-ratelimit-reset"));
  const waitSeconds =
    retryAfter > 0 ? retryAfter : reset > 0 ? reset - Date.now() / 1000 : 0;

  if (waitSeconds <= 0) {
    return "GitHub API rate limit reached. Try again later.";
  }
  const minutes = Math.ceil(waitSeconds / 60);
  return `GitHub API rate limit reached. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

function repoErrorDetail(response: Response): string {
  if (response.status === 401) {
    return "GitHub rejected the GITHUB_TOKEN setting. Check or remove it.";
  }
  if (response.status === 404) {
    return "Repo not found, or it's private. GitHub returns 404 for both.";
  }
  if (isRateLimited(response)) {
    return rateLimitDetail(response.headers);
  }
  return `GitHub returned HTTP ${response.status} for this repo.`;
}

type ReadmeResult = { readme: string | null; note: string };

// A missing README doesn't fail this check. The note explains why the text is absent.
async function fetchReadme(
  repo: GitHubRepo,
  signal: AbortSignal,
): Promise<ReadmeResult> {
  try {
    const response = await getFromApi(apiUrl(repo, "/readme"), signal);
    if (response.status === 404) {
      return { readme: null, note: " No README found." };
    }
    if (!response.ok) {
      return { readme: null, note: " Couldn't fetch the README." };
    }

    const { content, encoding } = await response.json();
    // GitHub leaves content empty, with encoding "none", for files over 1 MB.
    if (encoding !== "base64") {
      return { readme: null, note: " The README is too large to read." };
    }
    return { readme: Buffer.from(content, "base64").toString("utf8"), note: "" };
  } catch {
    return { readme: null, note: " Couldn't fetch the README." };
  }
}

export async function checkRepo(repo: GitHubRepo): Promise<RepoCheckResult> {
  const result = (
    status: Check["status"],
    detail: string,
    readme: string | null = null,
  ): RepoCheckResult => ({
    check: {
      id: "github_lookup",
      label: "GitHub lookup",
      mock: false,
      status,
      detail,
    },
    readme,
  });

  // Shared by both requests, so the whole check takes at most 10 seconds.
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const response = await getFromApi(apiUrl(repo), signal);
    if (!response.ok) {
      return result("fail", repoErrorDetail(response));
    }

    const data = await response.json();
    if (data.private) {
      return result("fail", "This repo is private. It must be public to verify.");
    }

    const lastPush = data.pushed_at ? data.pushed_at.slice(0, 10) : "none yet";
    const { readme, note } = await fetchReadme(repo, signal);
    return result(
      "pass",
      `Public repo. Default branch: ${data.default_branch}. Last push: ${lastPush}.${note}`,
      readme,
    );
  } catch {
    return result(
      "fail",
      signal.aborted
        ? `GitHub didn't respond within ${TIMEOUT_MS / 1000} seconds.`
        : "Couldn't get a valid response from GitHub.",
    );
  }
}
