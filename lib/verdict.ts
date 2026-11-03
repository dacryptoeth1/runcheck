export type CheckId =
  | "repo_clones"
  | "installs"
  | "builds"
  | "demo_loads"
  | "readme_matches";

export type Status = "pass" | "fail";

export type Check = {
  id: CheckId;
  label: string;
  status: Status;
  detail: string;
};

export type Verdict = {
  /** True until the checks run for real. */
  mock: boolean;
  verdict: Status;
  repoUrl: string;
  demoUrl: string;
  checks: Check[];
};

export type VerifyError = {
  error: string;
};
