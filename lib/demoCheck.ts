import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Check } from "@/lib/verdict";

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const blockedAddresses = new net.BlockList();

// Private, loopback, link-local and other ranges that aren't publicly routable.
// IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) are matched against the IPv4 rules.
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 96], // Includes :: and ::1
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address) === 6 ? "ipv6" : "ipv4";
  return blockedAddresses.check(address, family);
}

function isBlockedHostname(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return net.isIP(host) !== 0 && isBlockedAddress(host);
}

/** Returns why a demo URL can't be requested, or null if it's allowed. */
export function demoUrlError(url: URL): string | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Enter a demo URL starting with http:// or https://.";
  }
  if (url.username || url.password) {
    return "The demo URL can't include a username or password.";
  }
  if (isBlockedHostname(url)) {
    return "The demo URL can't point to a private or internal address.";
  }
  return null;
}

class BlockedAddressError extends Error {}

// Runs at connection time, so the address that was checked is the one connected
// to. Checking separately before the request would allow DNS rebinding.
const publicOnlyLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
    } else if (addresses.some(({ address }) => isBlockedAddress(address))) {
      callback(new BlockedAddressError(), "", 0);
    } else if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
};

type HopResponse = {
  status: number;
  location?: string;
  /** The HTML, if it was requested and this is a 2xx HTML response. */
  html?: string;
};

function requestHop(
  url: URL,
  signal: AbortSignal,
  readHtml: boolean,
): Promise<HopResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: publicOnlyLookup,
        signal,
        headers: { "User-Agent": "runcheck", Accept: "text/html,*/*" },
      },
      (response) => {
        const hop: HopResponse = {
          status: response.statusCode ?? 0,
          location: response.headers.location,
        };

        const isHtml = /html/i.test(response.headers["content-type"] ?? "");
        if (!readHtml || !isHtml || hop.status < 200 || hop.status >= 300) {
          resolve(hop);
          // Only the status matters, so don't download the body.
          response.destroy();
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () =>
          resolve({ ...hop, html: Buffer.concat(chunks).toString("utf8") });

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          // A page larger than the cap is compared using only its first part.
          if (size >= MAX_HTML_BYTES) {
            finish();
            response.destroy();
          }
        });
        response.on("end", finish);
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

class BlockedRedirectError extends Error {}
class TooManyRedirectsError extends Error {}

async function followRedirects(
  demoUrl: URL,
  signal: AbortSignal,
  readHtml: boolean,
): Promise<{ response: HopResponse; redirects: number }> {
  let url = demoUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    // Every hop is re-checked, because a public URL can redirect to an internal one.
    if (demoUrlError(url)) throw new BlockedRedirectError();

    const response = await requestHop(url, signal, readHtml);

    if (REDIRECT_STATUSES.has(response.status) && response.location) {
      url = new URL(response.location, url);
      continue;
    }
    return { response, redirects };
  }
  throw new TooManyRedirectsError();
}

function failureDetail(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) {
    return `Timed out after ${TIMEOUT_MS / 1000} seconds.`;
  }
  if (error instanceof BlockedRedirectError) {
    return "Blocked: a redirect points to an address that isn't allowed.";
  }
  if (error instanceof TooManyRedirectsError) {
    return `Stopped after ${MAX_REDIRECTS} redirects.`;
  }
  if (error instanceof BlockedAddressError) {
    return "Blocked: the demo URL resolves to a private or internal address.";
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Couldn't resolve the demo URL's hostname.";
  }
  return code
    ? `Couldn't connect to the demo URL (${code}).`
    : "Couldn't connect to the demo URL.";
}

export async function checkDemoLoads(demoUrl: URL): Promise<Check> {
  const result = (status: Check["status"], detail: string): Check => ({
    id: "demo_loads",
    label: "Demo loads",
    mock: false,
    status,
    detail,
  });

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const {
      response: { status },
      redirects,
    } = await followRedirects(demoUrl, signal, false);

    const elapsed = Math.round(performance.now() - startedAt);
    const via =
      redirects > 0
        ? ` after ${redirects} redirect${redirects === 1 ? "" : "s"}`
        : "";
    return result(
      status >= 200 && status < 300 ? "pass" : "fail",
      `HTTP ${status} in ${elapsed} ms${via}.`,
    );
  } catch (error) {
    return result("fail", failureDetail(error, signal));
  }
}

export type DemoPage = { html: string } | { error: string };

/** Downloads the demo page's HTML, with the same protections as checkDemoLoads. */
export async function fetchDemoPage(demoUrl: URL): Promise<DemoPage> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const { response } = await followRedirects(demoUrl, signal, true);
    if (response.status < 200 || response.status >= 300) {
      return { error: `It returned HTTP ${response.status}.` };
    }
    if (response.html === undefined) {
      return { error: "It isn't an HTML page." };
    }
    return { html: response.html };
  } catch (error) {
    return { error: failureDetail(error, signal) };
  }
}
