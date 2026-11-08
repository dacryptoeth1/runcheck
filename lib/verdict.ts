export type CheckId =
  | "github_lookup"
  | "repo_clones"
  | "installs"
  | "builds"
  | "demo_loads"
  | "readme_matches";

export type Status = "pass" | "fail";

/** "warning" is only used by advisory checks. */
export type CheckStatus = Status | "warning";

export type Check = {
  id: CheckId;
  label: string;
  /** True for fixed sample data. Every current check is real, so this is false. */
  mock: boolean;
  status: CheckStatus;
  /** True if this check is informational and doesn't affect the verdict. */
  advisory?: boolean;
  detail: string;
  /** Last 20 lines of command output, for checks that ran in the sandbox. */
  log?: string;
};

export type Verdict = {
  verdict: Status;
  repoUrl: string;
  demoUrl: string;
  checks: Check[];
};

export type VerifyError = {
  error: string;
};
