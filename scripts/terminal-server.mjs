// Backend for the ./terminal tab: one real shell (a PTY) per WebSocket.
//
// Run it as the site's service user, bound to localhost, behind nginx (see
// README → Terminal). Every connection must carry a valid admin session
// cookie and come from an allowed origin — nginx checks the session too, but
// this server never trusts that alone, since it hands out a shell.
//
// Protocol: the server sends raw terminal output as text frames. The client
// sends JSON: {"type":"input","data":"ls\r"} or {"type":"resize","cols":120,"rows":40}.
// When the shell exits the socket closes with code 4000, which the page
// takes as "close this pane".

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { WebSocketServer } from "ws";
import pty from "node-pty";

const HOST = process.env.TERM_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TERM_PORT ?? 8788);
const PATH = "/term";
const SHELL = process.env.TERM_SHELL ?? process.env.SHELL ?? "/bin/bash";
const CWD = process.env.TERM_CWD ?? homedir();
const ORIGINS = (process.env.TERM_ORIGINS ?? "https://admin.byjohnmichael.com")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
// the page allows 4 panes; leave room for a second tab or a reload
const MAX_SESSIONS = Number(process.env.TERM_MAX_SESSIONS ?? 12);
const SESSION_COOKIE = "admin_session";
const SECRET = process.env.SESSION_SECRET;

if (!SECRET || SECRET.length < 16) {
  console.error("[terminal] SESSION_SECRET is not set (must match the site's)");
  process.exit(1);
}

// Same format and signature as src/lib/auth.ts: "<expiresAt>.<user>.<hmac>".
function sessionUser(value) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [expiresAtRaw, user, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAtRaw || !user || !signature || Number.isNaN(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;
  const expected = createHmac("sha256", SECRET).update(`${expiresAt}.${user}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? user : null;
}

function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return undefined;
}

// The shell inherits the service's environment minus anything secret.
function shellEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|PASSWORD|API_KEY/i.test(key)) delete env[key];
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

const clamp = (n, lo, hi, fallback) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : fallback;

const server = createServer((_req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" }).end("WebSocket only\n");
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const reject = (status, text) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  };
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== PATH) return reject(404, "Not Found");
  if (!ORIGINS.includes(req.headers.origin ?? "")) return reject(403, "Forbidden");
  const user = sessionUser(readCookie(req.headers.cookie, SESSION_COOKIE));
  if (!user) return reject(401, "Unauthorized");
  if (wss.clients.size >= MAX_SESSIONS) return reject(429, "Too Many Requests");

  wss.handleUpgrade(req, socket, head, (ws) => {
    const cols = clamp(Number(url.searchParams.get("cols")), 10, 500, 80);
    const rows = clamp(Number(url.searchParams.get("rows")), 4, 200, 24);
    startSession(ws, user, cols, rows);
  });
});

function startSession(ws, user, cols, rows) {
  let shell;
  try {
    shell = pty.spawn(SHELL, ["-l"], { name: "xterm-256color", cols, rows, cwd: CWD, env: shellEnv() });
  } catch (err) {
    console.error(`[terminal] could not start ${SHELL}: ${err.message}`);
    ws.close(1011, "could not start shell");
    return;
  }
  console.log(`[terminal] ${user} opened pid ${shell.pid}`);

  shell.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  shell.onExit(({ exitCode }) => {
    console.log(`[terminal] pid ${shell.pid} exited (${exitCode})`);
    if (ws.readyState === ws.OPEN) ws.close(4000, "exit");
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg?.type === "input" && typeof msg.data === "string") {
      shell.write(msg.data);
    } else if (msg?.type === "resize") {
      shell.resize(clamp(msg.cols, 10, 500, cols), clamp(msg.rows, 4, 200, rows));
    }
  });

  // keep idle sockets alive through nginx's proxy_read_timeout
  let alive = true;
  ws.on("pong", () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on("close", () => {
    clearInterval(ping);
    try {
      shell.kill();
    } catch {
      // already gone
    }
  });
}

server.listen(PORT, HOST, () => {
  console.log(`[terminal] listening on ${HOST}:${PORT}${PATH} — shell ${SHELL}, cwd ${CWD}`);
});

// byjohnmichael*
