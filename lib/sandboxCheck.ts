import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { GitHubRepo } from "@/lib/repoCheck";
import type { Check, CheckId } from "@/lib/verdict";

const IMAGE = "node:22-bookworm";
const HOME_DIR = "/home/node";
const APP_DIR = `${HOME_DIR}/app`;

const CLONE_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 180_000;
const BUILD_TIMEOUT_MS = 180_000;
const INSPECT_TIMEOUT_MS = 10_000;
const DOCKER_INFO_TIMEOUT_MS = 10_000;
const CLEANUP_TIMEOUT_MS = 30_000;
// Longer than the other limits because the first run has to pull the image.
const START_TIMEOUT_MS = 300_000;

// The container stops itself after this long, so it can't outlive a crashed server.
const CONTAINER_LIFETIME_SECONDS =
  (CLONE_TIMEOUT_MS + INSTALL_TIMEOUT_MS + BUILD_TIMEOUT_MS + INSPECT_TIMEOUT_MS) /
    1000 +
  60;

const LOG_TAIL_LINES = 20;
const MAX_LOG_LINE_CHARS = 300;
// Untrusted builds can print without limit, so only the end of the output is kept.
const MAX_OUTPUT_CHARS = 64_000;

const PACKAGE_MANAGERS = {
  npm: { install: ["npm", "install"], build: ["npm", "run", "build"] },
  pnpm: {
    install: ["corepack", "pnpm", "install"],
    build: ["corepack", "pnpm", "run", "build"],
  },
  yarn: {
    install: ["corepack", "yarn", "install"],
    build: ["corepack", "yarn", "run", "build"],
  },
};

type PackageManager = keyof typeof PACKAGE_MANAGERS;

type ProjectInfo = {
  hasPackageJson: boolean;
  hasBuild: boolean;
  manager: PackageManager;
};

// Runs after the clone and before any of the repo's own code.
const INSPECT_SCRIPT = `
const fs = require("fs");
let hasBuild = false;
try {
  const build = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts?.build;
  hasBuild = typeof build === "string" && build.trim() !== "";
} catch {}
const manager = fs.existsSync("pnpm-lock.yaml")
  ? "pnpm"
  : fs.existsSync("yarn.lock")
    ? "yarn"
    : "npm";
process.stdout.write(
  JSON.stringify({ hasPackageJson: fs.existsSync("package.json"), hasBuild, manager }),
);
`;

/** Docker can't run verifications on this server. */
export class SandboxUnavailableError extends Error {
  constructor(reason: string) {
    super(`Sandbox unavailable: ${reason}`);
  }
}

type CommandResult = {
  exitCode: number | null;
  timedOut: boolean;
  /** The docker binary couldn't be launched at all. */
  spawnFailed: boolean;
  output: string;
};

function runDocker(args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    // No shell is involved, so arguments are never interpreted as shell syntax.
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;
    const append = (chunk: string) => {
      output = (output + chunk).slice(-MAX_OUTPUT_CHARS);
    };
    child.stdout.setEncoding("utf8").on("data", append);
    child.stderr.setEncoding("utf8").on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, spawnFailed: true, output });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut, spawnFailed: false, output });
    });
  });
}

function logTail(output: string): string {
  return output
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .split(/\r\n|\n|\r/)
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/g, "").trimEnd())
    .filter(Boolean)
    .slice(-LOG_TAIL_LINES)
    .map((line) =>
      line.length > MAX_LOG_LINE_CHARS
        ? `${line.slice(0, MAX_LOG_LINE_CHARS)}…`
        : line,
    )
    .join("\n");
}

async function assertDockerAvailable(): Promise<void> {
  const result = await runDocker(
    ["version", "--format", "{{.Server.Version}}"],
    DOCKER_INFO_TIMEOUT_MS,
  );
  if (result.spawnFailed) {
    throw new SandboxUnavailableError(
      "the docker command isn't installed on this server.",
    );
  }
  if (result.timedOut || result.exitCode !== 0) {
    console.error("docker version failed:", result.output);
    throw new SandboxUnavailableError(
      "the Docker daemon can't be reached. It may be stopped, or this server's user may not have permission to use it.",
    );
  }
}

async function startContainer(name: string): Promise<void> {
  const result = await runDocker(
    [
      "run",
      "--detach",
      "--rm",
      `--name=${name}`,
      "--memory=1g",
      "--cpus=1",
      "--pids-limit=256",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges",
      "--user=node",
      `--workdir=${HOME_DIR}`,
      "--env=GIT_TERMINAL_PROMPT=0",
      "--env=COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
      "--env=NPM_CONFIG_AUDIT=false",
      "--env=NPM_CONFIG_FUND=false",
      "--env=NPM_CONFIG_UPDATE_NOTIFIER=false",
      IMAGE,
      // The shell reaps orphaned processes, which would otherwise use up the PID limit.
      "sh",
      "-c",
      `sleep ${CONTAINER_LIFETIME_SECONDS} & wait`,
    ],
    START_TIMEOUT_MS,
  );

  if (result.spawnFailed || result.timedOut || result.exitCode !== 0) {
    console.error("docker run failed:", result.output);
    throw new SandboxUnavailableError(
      result.timedOut
        ? "Docker took too long to start a container."
        : `Docker couldn't start a ${IMAGE} container.`,
    );
  }
}

function makeCheck(
  id: CheckId,
  label: string,
  status: Check["status"],
  detail: string,
  log?: string,
): Check {
  return { id, label, mock: false, status, detail, ...(log ? { log } : {}) };
}

type Stage = { id: CheckId; label: string; command: string; timeoutMs: number };

const CLONE_STAGE = {
  id: "repo_clones",
  label: "Repo clones",
  timeoutMs: CLONE_TIMEOUT_MS,
} as const;
const INSTALL_STAGE = {
  id: "installs",
  label: "Dependencies install",
  timeoutMs: INSTALL_TIMEOUT_MS,
} as const;
const BUILD_STAGE = {
  id: "builds",
  label: "Project builds",
  timeoutMs: BUILD_TIMEOUT_MS,
} as const;

async function runStage(
  containerName: string,
  stage: Stage,
  workdir: string,
  command: string[],
): Promise<Check> {
  const result = await runDocker(
    ["exec", `--workdir=${workdir}`, containerName, ...command],
    stage.timeoutMs,
  );
  const log = logTail(result.output);

  if (result.timedOut) {
    return makeCheck(
      stage.id,
      stage.label,
      "fail",
      `${stage.command} timed out after ${stage.timeoutMs / 1000} seconds, so the container was killed.`,
      log,
    );
  }
  if (result.exitCode !== 0) {
    return makeCheck(
      stage.id,
      stage.label,
      "fail",
      `${stage.command} failed with exit code ${result.exitCode ?? "unknown"}.`,
      log,
    );
  }
  return makeCheck(
    stage.id,
    stage.label,
    "pass",
    `${stage.command} finished without errors.`,
    log,
  );
}

async function inspectProject(
  containerName: string,
): Promise<ProjectInfo | null> {
  const result = await runDocker(
    ["exec", `--workdir=${APP_DIR}`, containerName, "node", "-e", INSPECT_SCRIPT],
    INSPECT_TIMEOUT_MS,
  );
  if (result.timedOut || result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

function skipped(stage: typeof INSTALL_STAGE | typeof BUILD_STAGE, why: string) {
  return makeCheck(stage.id, stage.label, "fail", `Skipped: ${why}`);
}

async function runStages(
  containerName: string,
  { owner, repo }: GitHubRepo,
): Promise<Check[]> {
  const cloneCheck = await runStage(
    containerName,
    { ...CLONE_STAGE, command: "git clone" },
    HOME_DIR,
    [
      "git",
      "clone",
      "--depth",
      "1",
      "--",
      `https://github.com/${owner}/${repo}.git`,
      APP_DIR,
    ],
  );
  if (cloneCheck.status === "fail") {
    const why = "the repo didn't clone.";
    return [cloneCheck, skipped(INSTALL_STAGE, why), skipped(BUILD_STAGE, why)];
  }

  const project = await inspectProject(containerName);
  if (!project) {
    return [
      cloneCheck,
      makeCheck(
        INSTALL_STAGE.id,
        INSTALL_STAGE.label,
        "fail",
        "Couldn't read the project files after cloning.",
      ),
      skipped(BUILD_STAGE, "the project files couldn't be read."),
    ];
  }
  if (!project.hasPackageJson) {
    return [
      cloneCheck,
      makeCheck(
        INSTALL_STAGE.id,
        INSTALL_STAGE.label,
        "fail",
        "No package.json at the repo root, so there's nothing to install.",
      ),
      skipped(BUILD_STAGE, "there's no package.json at the repo root."),
    ];
  }

  const commands = PACKAGE_MANAGERS[project.manager];
  const installCheck = await runStage(
    containerName,
    { ...INSTALL_STAGE, command: `${project.manager} install` },
    APP_DIR,
    commands.install,
  );
  if (installCheck.status === "fail") {
    return [
      cloneCheck,
      installCheck,
      skipped(BUILD_STAGE, "dependencies didn't install."),
    ];
  }

  if (!project.hasBuild) {
    return [
      cloneCheck,
      installCheck,
      makeCheck(
        BUILD_STAGE.id,
        BUILD_STAGE.label,
        "pass",
        "package.json has no build script, so there was nothing to build.",
      ),
    ];
  }

  const buildCheck = await runStage(
    containerName,
    { ...BUILD_STAGE, command: `${project.manager} run build` },
    APP_DIR,
    commands.build,
  );
  return [cloneCheck, installCheck, buildCheck];
}

/**
 * Clones, installs and builds a repo inside a throwaway container.
 * Throws SandboxUnavailableError if Docker can't run it, so that no result is reported.
 */
export async function runSandboxChecks(repo: GitHubRepo): Promise<Check[]> {
  await assertDockerAvailable();

  const containerName = `runcheck-${randomUUID()}`;
  try {
    await startContainer(containerName);
    return await runStages(containerName, repo);
  } finally {
    // Killing the docker CLI doesn't stop what it started inside the container.
    // This SIGKILLs the container, and also runs after a timeout. Errors are
    // ignored because the container may already be gone.
    await runDocker(["rm", "--force", containerName], CLEANUP_TIMEOUT_MS);
  }
}
