"use client";

import { useState, type FormEvent } from "react";
import type { CheckStatus, Verdict } from "@/lib/verdict";
import styles from "./page.module.css";

const BADGE_TEXT: Record<CheckStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  warning: "Warning",
};

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [result, setResult] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
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
      } else {
        setError(data.error ?? "Verification failed. Try again.");
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const requiredChecks = result?.checks.filter((c) => !c.advisory) ?? [];

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

      <div aria-live="polite">
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {result && (
          <section className={styles.results}>
            <div className={styles.summary}>
              <h2>{result.verdict === "pass" ? "Verified" : "Not verified"}</h2>
              <span className={styles.summaryCount}>
                {requiredChecks.filter((c) => c.status === "pass").length} of{" "}
                {requiredChecks.length} required checks passed
              </span>
            </div>

            <ul className={styles.checks}>
              {result.checks.map((check) => (
                <li
                  key={check.id}
                  className={`${styles.check} ${styles[check.status]}`}
                >
                  <div className={styles.checkBody}>
                    <h3>{check.label}</h3>
                    <p>{check.detail}</p>
                    {check.log && (
                      <details
                        className={styles.log}
                        open={check.status === "fail"}
                      >
                        <summary>Log (last 20 lines)</summary>
                        <pre>{check.log}</pre>
                      </details>
                    )}
                  </div>
                  <span className={styles.badge}>
                    {BADGE_TEXT[check.status]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
