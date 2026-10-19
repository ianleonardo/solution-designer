// Draws Mermaid diagrams in headless Chrome and prints a JSON array of {svg} or {error}.
// Chrome is the same engine the Markdown preview uses, so HTML and PDF match that picture.
// Stdin: {"sources": ["flowchart LR\n  A-->B"], "htmlLabels": true}
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function mermaidFile() {
  const candidates = [
    join(here, "../../node_modules/mermaid/dist/mermaid.esm.min.mjs"),
    join(here, "../node_modules/mermaid/dist/mermaid.esm.min.mjs"),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function chromePath() {
  const candidates = [
    process.env.MERMAID_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((file) => file && existsSync(file)) ?? null;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function cdp(socket) {
  let next = 0;
  const pending = new Map();
  const loaded = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Page.loadEventFired") {
      loaded.get(message.sessionId)?.();
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });
  send.loaded = (sessionId) =>
    new Promise((resolve) => {
      loaded.set(sessionId, resolve);
    });
  return send;
}

function waitForPort(proc) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not open a debugging port")), 15000);
    const onData = (chunk) => {
      const match = /DevTools listening on ws:\/\/(?:127\.0\.0\.1|\[::1\]):(\d+)/.exec(chunk.toString());
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    };
    proc.stderr.on("data", onData);
    proc.on("exit", () => {
      clearTimeout(timer);
      reject(new Error("Chrome exited before it was ready"));
    });
  });
}

function pageHtml(sources, htmlLabels) {
  const mermaid = mermaidFile();
  const embedded = JSON.stringify(sources).replace(/</g, "\\u003c");
  const href = JSON.stringify(pathToFileURL(mermaid).href);
  return `<!DOCTYPE html><html><body>
<script type="module">
import mermaid from ${href};
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "default",
  htmlLabels: ${htmlLabels ? "true" : "false"},
});
const sources = ${embedded};
const out = [];
for (let i = 0; i < sources.length; i++) {
  try {
    const result = await mermaid.render("exportDiagram" + i, sources[i]);
    out.push({ svg: result.svg });
  } catch (err) {
    out.push({ error: err instanceof Error ? err.message : String(err) });
  }
}
window.__result = out;
</script>
</body></html>`;
}

async function render(sources, htmlLabels) {
  const chrome = chromePath();
  if (!chrome) throw new Error("Chrome is not installed");
  if (!mermaidFile()) throw new Error("Mermaid is not installed");
  const folder = await mkdtemp(join(tmpdir(), "mermaid-"));
  const page = join(folder, "page.html");
  await writeFile(page, pageHtml(sources, htmlLabels), "utf8");
  const proc = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--allow-file-access-from-files",
      "--remote-debugging-port=0",
      `--user-data-dir=${folder}/profile`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let socket;
  try {
    const port = await waitForPort(proc);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome")), { once: true });
    });
    const send = cdp(socket);
    const created = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await send("Page.enable", {}, sessionId);
    const ready = send.loaded(sessionId);
    await send("Page.navigate", { url: pathToFileURL(page).href }, sessionId);
    await ready;
    const evaluated = await send(
      "Runtime.evaluate",
      {
        expression: `new Promise((resolve) => {
          const start = Date.now();
          const tick = () => {
            if (window.__result) resolve(JSON.stringify(window.__result));
            else if (Date.now() - start > 25000) resolve("");
            else setTimeout(tick, 40);
          };
          tick();
        })`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    const raw = evaluated?.result?.value;
    if (!raw) throw new Error("Mermaid did not finish drawing");
    return JSON.parse(raw);
  } finally {
    try {
      socket?.close();
    } catch {
      // The browser is about to be stopped anyway.
    }
    proc.kill("SIGKILL");
    await rm(folder, { recursive: true, force: true });
  }
}

const request = JSON.parse(await readStdin());
const sources = Array.isArray(request.sources) ? request.sources : [];
try {
  const drawn = await render(sources, request.htmlLabels !== false);
  process.stdout.write(JSON.stringify(drawn));
} catch (err) {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
