// Screenshots every page of a running desktop started with XTEND_REMOTE_DEBUG=<port>.
// For headless hosts where screencapture has no display. Usage:
//   node scripts/cdp-screenshot.mjs 9223 /tmp/xtend
import { writeFile } from "node:fs/promises";

const [port = "9223", prefix = "/tmp/xtend"] = process.argv.slice(2);
const CALL_TIMEOUT_MS = 5_000;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();

const capture = async (target, index) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("socket failed"));
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const id = 1;
      const timer = setTimeout(() => reject(new Error("timed out")), CALL_TIMEOUT_MS);
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      socket.send(
        JSON.stringify({ id, method: "Page.captureScreenshot", params: { format: "png" } }),
      );
    });
    const file = `${prefix}-${index}.png`;
    await writeFile(file, Buffer.from(result.data, "base64"));
    console.log(`${file}  ${target.url}`);
  } finally {
    socket.close();
  }
};

for (const [index, target] of targets.filter((t) => t.type === "page").entries()) {
  try {
    await capture(target, index);
  } catch (error) {
    console.log(`skipped ${target.url}: ${error.message}`);
  }
}
