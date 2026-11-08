import type { DemoPage } from "@/lib/demoCheck";
import type { Check } from "@/lib/verdict";

const MATCH_THRESHOLD_PERCENT = 40;
const MAX_TERMS = 30;
const MAX_TERM_WORDS = 6;
const MIN_TERM_CHARS = 3;
// READMEs are untrusted. These bounds keep the line regexes fast on hostile input.
const MAX_README_CHARS = 100_000;
const MAX_LINE_CHARS = 1_000;
// Below this, the HTML is probably an empty shell filled in by JavaScript.
const THIN_PAGE_WORDS = 30;

const STOP_WORDS = new Set(
  "a an and are as at be by can for from in is it of on or our that the this to we will with you your".split(
    " ",
  ),
);

// Section titles and labels found in most READMEs, which say nothing about the project.
const BOILERPLATE_TERMS = new Set([
  "about",
  "acknowledgements",
  "acknowledgments",
  "api",
  "authors",
  "built with",
  "changelog",
  "configuration",
  "contact",
  "contents",
  "contributing",
  "demo",
  "deploy",
  "deployment",
  "development",
  "documentation",
  "environment variables",
  "faq",
  "features",
  "getting started",
  "important",
  "install",
  "installation",
  "introduction",
  "key features",
  "learn more",
  "license",
  "note",
  "overview",
  "prerequisites",
  "project structure",
  "quick start",
  "quickstart",
  "requirements",
  "run it",
  "running locally",
  "screenshots",
  "scripts",
  "setup",
  "support",
  "table of contents",
  "tech stack",
  "testing",
  "tests",
  "tip",
  "usage",
  "warning",
]);

const FEATURE_HEADING = /feature|highlight|capabilit|functionality|what (it|this) does/i;
const COMMAND_WORDS = new Set(
  "bun cd curl docker git node npm npx pip pnpm python sudo yarn".split(" "),
);
const CODE_FILE_NAME =
  /\.(c?js|mjs|jsx|tsx?|json|md|ya?ml|toml|lock|env|sh|py|css|html|txt)$/i;

type Term = { display: string; words: string[] };

function wordsIn(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function removeBlockComments(text: string): string {
  const parts: string[] = [];
  let position = 0;
  while (position < text.length) {
    const start = text.indexOf("<!--", position);
    if (start === -1) {
      parts.push(text.slice(position));
      break;
    }
    parts.push(text.slice(position, start));
    const end = text.indexOf("-->", start + 4);
    if (end === -1) break;
    position = end + 3;
  }
  return parts.join("\n");
}

function plainInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\*\*|__|[`*]/g, "");
}

function cleanEdges(text: string): string {
  return text
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}+#)]+$/u, "")
    .replace(/\s+/g, " ");
}

function isCodeNoise(code: string): boolean {
  return (
    /[/\\=$<>{}|]/.test(code) ||
    /^[.-]/.test(code) ||
    /^[A-Z0-9_]+$/.test(code) ||
    CODE_FILE_NAME.test(code) ||
    COMMAND_WORDS.has(code.split(/\s/)[0].toLowerCase())
  );
}

function extractTerms(readme: string): Term[] {
  const headings: string[] = [];
  const features: string[] = [];
  const bold: string[] = [];
  const code: string[] = [];

  let inFence = false;
  let featureLevel: number | null = null;

  for (const line of removeBlockComments(
    readme.slice(0, MAX_README_CHARS),
  ).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.length > MAX_LINE_CHARS) continue;

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = plainInline(heading[2]);
      headings.push(text);
      if (featureLevel !== null && level <= featureLevel) featureLevel = null;
      if (featureLevel === null && FEATURE_HEADING.test(text)) {
        featureLevel = level;
      }
    }

    const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (bullet && featureLevel !== null) {
      // "Name: description" and "Name - description" are named by the first part.
      const name = plainInline(bullet[1]).split(/:\s|\s[-–—]\s/)[0];
      features.push(name.trim().split(/\s+/).slice(0, MAX_TERM_WORDS).join(" "));
    }

    for (const match of line.matchAll(/`([^`]{2,60})`/g)) {
      if (!isCodeNoise(match[1])) code.push(match[1]);
    }
    for (const match of line.matchAll(/\*\*([^*]{2,80})\*\*|__([^_]{2,80})__/g)) {
      bold.push(plainInline(match[1] ?? match[2]));
    }
  }

  const terms = new Map<string, Term>();
  for (const candidate of [...headings, ...features, ...bold, ...code]) {
    const display = cleanEdges(candidate);
    const allWords = wordsIn(display);
    const words = allWords.filter((word) => !STOP_WORDS.has(word));
    const key = allWords.join(" ");

    if (
      words.length > 0 &&
      words.join("").length >= MIN_TERM_CHARS &&
      allWords.length <= MAX_TERM_WORDS &&
      !BOILERPLATE_TERMS.has(key) &&
      !terms.has(key)
    ) {
      terms.set(key, { display, words });
    }
  }
  return [...terms.values()].slice(0, MAX_TERMS);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntity(entity: string, body: string): string {
  if (!body.startsWith("#")) return NAMED_ENTITIES[body] ?? entity;
  const code = body.startsWith("#x")
    ? parseInt(body.slice(2), 16)
    : parseInt(body.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}

const NON_TEXT_ELEMENTS = new Set(["script", "style", "noscript", "template"]);

// A hand-written scan rather than regexes, because demo pages are untrusted and
// a regex like <script[\s\S]*?</script> takes quadratic time on unclosed tags.
function htmlText(html: string): string {
  const lower = html.toLowerCase();
  const parts: string[] = [];
  let position = 0;

  while (position < lower.length) {
    const open = lower.indexOf("<", position);
    if (open === -1) {
      parts.push(lower.slice(position));
      break;
    }
    parts.push(lower.slice(position, open));

    if (lower.startsWith("<!--", open)) {
      const end = lower.indexOf("-->", open + 4);
      if (end === -1) break;
      position = end + 3;
      continue;
    }

    if (!/[a-z/!?]/.test(lower.charAt(open + 1))) {
      parts.push("<");
      position = open + 1;
      continue;
    }

    const close = lower.indexOf(">", open + 1);
    if (close === -1) break;
    position = close + 1;
    parts.push(" ");

    const name = lower.slice(open + 1, open + 12).match(/^[a-z]+/)?.[0];
    if (name && NON_TEXT_ELEMENTS.has(name)) {
      const endTag = lower.indexOf(`</${name}`, close + 1);
      if (endTag === -1) break;
      const endTagClose = lower.indexOf(">", endTag);
      if (endTagClose === -1) break;
      position = endTagClose + 1;
    }
  }

  return parts
    .join("")
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/g, decodeEntity);
}

export function checkReadmeMatches(
  readme: string | null,
  page: DemoPage,
): Check {
  const result = (status: Check["status"], detail: string): Check => ({
    id: "readme_matches",
    label: "README matches (keyword heuristic)",
    mock: false,
    status,
    detail: `Keyword-based heuristic, not a perfect check. ${detail}`,
  });

  if (readme === null) {
    return result("fail", "GitHub didn't provide a README to compare.");
  }
  if ("error" in page) {
    return result("fail", `Couldn't read the demo page. ${page.error}`);
  }

  const terms = extractTerms(readme);
  if (terms.length === 0) {
    return result("fail", "Found no key terms in the README to compare.");
  }

  const pageWords = new Set(wordsIn(htmlText(page.html)));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const term of terms) {
    const found = term.words.every((word) => pageWords.has(word));
    (found ? matched : missing).push(term.display);
  }

  const passed = matched.length * 100 >= terms.length * MATCH_THRESHOLD_PERCENT;
  const percent = Math.round((matched.length / terms.length) * 100);
  const thinPageNote =
    !passed && pageWords.size < THIN_PAGE_WORDS
      ? " The page's HTML has very little text, so it may be rendered by JavaScript, which this check can't see."
      : "";

  return result(
    passed ? "pass" : "fail",
    `${matched.length} of ${terms.length} README terms found on the demo page (${percent}%, needs ${MATCH_THRESHOLD_PERCENT}%).` +
      ` Matched: ${matched.join(", ") || "none"}.` +
      ` Missing: ${missing.join(", ") || "none"}.${thinPageNote}`,
  );
}
