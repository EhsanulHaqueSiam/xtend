/** Why the app page did not load, and when. */
export interface LoadFailure {
  /** Short and lower case, e.g. "connection refused". */
  readonly reason: string;
  /** Epoch ms. */
  readonly at: number;
}

/** "ERR_CONNECTION_REFUSED" (Chromium's net error names) as "connection refused". */
export const failureReason = (code: string) =>
  code.replace(/^ERR_/, "").replaceAll("_", " ").toLowerCase() || "no answer";

const html = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Ships with the desktop so service configuration is reachable even when the app cannot load. */
export function recoveryPage(serviceUrl: string, failure: LoadFailure) {
  const url = html(serviceUrl);
  const where = html(`${serviceUrl.replace(/^https?:\/\//, "")} · ${failure.reason}`);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xtend</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font:13px system-ui,sans-serif}header{height:52px;-webkit-app-region:drag}main{max-width:520px;margin:100px auto;padding:24px}h1{font-size:18px;margin:0 0 8px}p{color:#999;line-height:1.5;overflow-wrap:anywhere}form{display:grid;gap:14px;margin-top:24px}label{display:grid;gap:6px}input{width:100%;background:#000;color:#fff;border:1px solid #333;border-radius:8px;padding:8px;font:13px ui-monospace,monospace}input:focus-visible,button:focus-visible{outline:2px solid #fff;outline-offset:2px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}button{background:#000;color:#fff;border:1px solid #444;border-radius:999px;padding:7px 12px;font:inherit;cursor:pointer}h1+p{font:12px ui-monospace,monospace}button.primary{background:#fff;color:#000;border-color:#fff}button:disabled{opacity:.5;cursor:default}#status{min-height:20px;font-size:12px}small{display:block;color:#999;margin-top:16px}
</style><header></header><main><h1>Can't reach the service</h1><p id="failure" data-url="${url}">${where} · <span id="ago">now</span></p>
<div class="actions"><button type="button" class="primary" id="retry">Retry</button><button type="button" id="local">Use local service</button></div>
<form><label>Service URL<input name="url" type="url" required spellcheck="false" autocomplete="off"></label><label>Service token<input name="token" type="password" autocomplete="off"></label><div class="actions"><button type="submit" id="connect">Connect and relaunch</button></div></form>
<p id="status" role="status">Check the service is running, or change the connection.</p><small>Retries automatically every 20 seconds.</small></main>
<script>
const bridge = window.desktopBridge;
const form = document.querySelector('form');
const url = form.elements.namedItem('url');
const token = form.elements.namedItem('token');
url.value = bridge.remote?.url ?? document.querySelector('#failure').dataset.url;
token.value = bridge.remote?.token ?? bridge.serviceToken;
document.querySelector('#retry').onclick = () => bridge.retryService();
document.querySelector('#local').onclick = () => bridge.setRemote(null);
form.onsubmit = async (event) => {
  event.preventDefault();
  const button = document.querySelector('#connect');
  const status = document.querySelector('#status');
  button.disabled = true;
  status.textContent = 'Checking…';
  const config = {url:url.value.trim(),token:token.value.trim()};
  try {
    const result = await bridge.checkRemote(config);
    if (result.health && result.auth) bridge.setRemote(config);
    else status.textContent = result.error ?? 'Service unreachable';
  } catch { status.textContent = 'Service unreachable'; }
  finally { button.disabled = false; }
};
let edited = false;
form.oninput = () => { edited = true; };
setInterval(() => { if (!edited && document.activeElement === document.body) bridge.retryService(); }, 20000);
// How long ago it failed, rewritten once a second: text only, nothing animates.
const ago = document.querySelector('#ago');
const tick = () => {
  const s = Math.max(0, Math.round((Date.now() - ${failure.at}) / 1000));
  ago.textContent = s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : Math.floor(s / 3600) + 'h ago';
};
tick();
setInterval(tick, 1000);
</script></html>`;
}
