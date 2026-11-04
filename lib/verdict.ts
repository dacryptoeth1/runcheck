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
  /** True if this is fixed sample data rather than a real result. */
  mock: boolean;
  status: Status;
  detail: string;
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
