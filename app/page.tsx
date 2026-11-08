"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Check, CheckStatus, Verdict } from "@/lib/verdict";
import styles from "./page.module.css";

const BADGE_TEXT: Record<CheckStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  warning: "Warning",
};

const REVEAL_INTERVAL_MS = 380;

// Shown while waiting. The API returns all results at once, so these are placeholders.
const PENDING_CHECKS: Pick<Check, "id" | "label">[] = [
  { id: "github_lookup", label: "GitHub lookup" },
  { id: "repo_clones", label: "Repo clones" },
  { id: "installs", label: "Dependencies install" },
  { id: "builds", label: "Project builds" },
  { id: "demo_loads", label: "Demo loads" },
  { id: "readme_matches", label: "README matches (advisory keyword heuristic)" },
];

function StatusIcon({ status }: { status: CheckStatus }) {
  const mark = {
    pass: "M4.6 8.3l2.3 2.3 4.5-4.9",
    fail: "M5.5 5.5l5 5M10.5 5.5l-5 5",
    warning: "M8 4.6v4.1M8 11.2v.1",
  }[status];

  return (
    <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
      <circle className={styles.iconRing} cx="8" cy="8" r="7" pathLength={1} />
      <path className={styles.iconMark} d={mark} pathLength={1} />
    </svg>
  );
}

function LogSection({
  log,
  initiallyOpen,
}: {
  log: string;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const panelId = useId();

  return (
    <div className={styles.log}>
      <button
        type="button"
        className={styles.logToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <svg className={styles.chevron} viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 1.5L7 5l-3.5 3.5" />
        </svg>
        Log (last 20 lines)
      </button>
      <div
        id={panelId}
        className={`${styles.logPanel} ${open ? styles.logPanelOpen : ""}`}
      >
        <div className={styles.logPanelInner}>
          <pre>{log}</pre>
        </div>
      </div>
    </div>
  );
}

function CheckCard({ label, check }: { label: string; check: Check | null }) {
  return (
    <li className={`${styles.check} ${check ? styles[check.status] : styles.pending}`}>
      {check ? (
        <div key="resolved" className={`${styles.checkInner} ${styles.resolved}`}>
          <div className={styles.checkBody}>
            <h3>{check.label}</h3>
            <p>{check.detail}</p>
            {check.log && (
              <LogSection
                log={check.log}
                initiallyOpen={check.status === "fail"}
              />
            )}
          </div>
          <span className={styles.badge}>
            <StatusIcon status={check.status} />
            {BADGE_TEXT[check.status]}
          </span>
        </div>
      ) : (
        <div key="pending" className={styles.checkInner}>
          <div className={styles.checkBody}>
            <h3>{label}</h3>
            <div className={styles.skeleton} aria-hidden="true" />
          </div>
          <span className={styles.pendingDot} aria-hidden="true" />
        </div>
      )}
    </li>
  );
}

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [result, setResult] = useState<Verdict | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopReveal() {
    if (revealTimer.current !== null) clearInterval(revealTimer.current);
    revealTimer.current = null;
  }

  useEffect(() => stopReveal, []);

  function revealChecks(total: number) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealedCount(total);
      return;
    }

    let count = 0;
    revealTimer.current = setInterval(() => {
      count++;
      setRevealedCount(count);
      if (count >= total) stopReveal();
    }, REVEAL_INTERVAL_MS);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    stopReveal();
    setLoading(true);
    setResult(null);
    setRevealedCount(0);
    setError(null);

    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, demoUrl }),
      });
      const data = await response.json();
      if (response.ok) {
        setResult(data);
        revealChecks(data.checks.length);
      } else {
        setError(data.error ?? "Verification failed. Try again.");
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const total = result?.checks.length ?? PENDING_CHECKS.length;
  const finished = result !== null && revealedCount >= total;
  const verified = result?.verdict === "pass";
  const verdictText = verified ? "Verified" : "Not verified";

  const requiredChecks = result?.checks.filter((c) => !c.advisory) ?? [];
  const summary = `${requiredChecks.filter((c) => c.status === "pass").length} of ${requiredChecks.length} required checks passed`;

  const rows = result?.checks ?? PENDING_CHECKS;
  let statusClass = "";
  if (finished) statusClass = verified ? styles.verified : styles.notVerified;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>runcheck</h1>
        <p>Check that a hackathon project runs and matches its demo.</p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>GitHub repo URL</span>
          <input
            type="url"
            name="repoUrl"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Demo URL</span>
          <input
            type="url"
            name="demoUrl"
            placeholder="https://my-project.example.com"
            value={demoUrl}
            onChange={(event) => setDemoUrl(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Verifying… this can take several minutes" : "Verify project"}
        </button>
      </form>

      {/* Announces only the start and the outcome, not each card as it resolves. */}
      <p role="status" className={styles.srOnly}>
        {loading && "Verifying project."}
        {finished && `${verdictText}. ${summary}.`}
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {(loading || result) && (
        <section className={styles.results}>
          <div className={`${styles.status} ${statusClass}`}>
            <div className={styles.statusSlot}>
              {finished ? (
                <>
                  <div className={styles.verdict}>
                    <StatusIcon status={verified ? "pass" : "fail"} />
                    <h2>{verdictText}</h2>
                  </div>
                  <span className={styles.summaryCount}>{summary}</span>
                </>
              ) : (
                <span className={styles.summaryCount}>
                  {result
                    ? `${revealedCount} of ${total} checks complete`
                    : "Running the checks. Results appear when they all finish."}
                </span>
              )}
            </div>

            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label="Checks complete"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={result ? revealedCount : undefined}
            >
              <div
                className={`${styles.progressFill} ${result ? "" : styles.indeterminate}`}
                style={
                  result
                    ? { transform: `scaleX(${revealedCount / total})` }
                    : undefined
                }
              />
            </div>
          </div>

          <ul className={styles.checks}>
            {rows.map((row, index) => (
              <CheckCard
                key={row.id}
                label={row.label}
                check={result && index < revealedCount ? result.checks[index] : null}
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
