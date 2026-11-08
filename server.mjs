import { createServer } from "node:http";

// Set before Next.js loads, so `node server.mjs` always runs the production build.
process.env.NODE_ENV = "production";
const { default: next } = await import("next");

const port = Number(process.env.PORT) || 3000;
// IPv4 only: one IPv6 host can hold a whole /64, which would dodge per-IP limits.
const hostname = "0.0.0.0";

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

createServer((req, res) => {
  // Next.js keeps any x-forwarded-for the client sends, which would let anyone
  // fake their IP. This server is exposed directly, so the socket is the truth.
  // Behind a reverse proxy this would be the proxy's address. See DEPLOY.md.
  req.headers["x-forwarded-for"] = req.socket.remoteAddress;
  handle(req, res);
}).listen(port, hostname, () => {
  console.log(`> runcheck listening on http://${hostname}:${port}`);
});
