"use client";

import { useState, type FormEvent } from "react";
import type { Verdict } from "@/lib/verdict";
import styles from "./page.module.css";

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
          {loading ? "Verifying…" : "Verify project"}
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
                {result.checks.filter((c) => c.status === "pass").length} of{" "}
                {result.checks.length} checks passed
              </span>
            </div>

            {result.mock && (
              <p className={styles.mockNotice}>
                Sample data: these checks didn&apos;t run against your project.
              </p>
            )}

            <ul className={styles.checks}>
              {result.checks.map((check) => (
                <li
                  key={check.id}
                  className={`${styles.check} ${styles[check.status]}`}
                >
                  <div>
                    <h3>{check.label}</h3>
                    <p>{check.detail}</p>
                  </div>
                  <span className={styles.badge}>
                    {check.status === "pass" ? "Pass" : "Fail"}
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
