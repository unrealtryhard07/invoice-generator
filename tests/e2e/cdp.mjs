// Minimal Chrome DevTools Protocol driver: headless Chrome with a throwaway profile (never your real data).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const ARTIFACTS = new URL('./.artifacts/', import.meta.url).pathname;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(port = 9400 + Math.floor(Math.random() * 400)) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const profile = mkdtempSync(join(ARTIFACTS, 'profile-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 60 && !targets.length; i += 1) {
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page'); } catch { await sleep(200); }
  }
  if (!targets.length) throw new Error('Chrome did not start');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });

  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg);
  });
  const send = (method, params = {}) => new Promise((resolve) => { seq += 1; pending.set(seq, resolve); ws.send(JSON.stringify({ id: seq, method, params })); });

  /** Evaluates an expression in the page; throws on page exceptions so failures are loud. */
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error(r.error.message);
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  }

  /** Real mouse click at the element's centre (goes through hit-testing, unlike el.click()). */
  async function click(selector) {
    const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
      el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!box) throw new Error(`Nothing to click: ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(250);
  }

  async function screenshot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(ARTIFACTS, name), Buffer.from(r.result.data, 'base64'));
  }

  // Blocked Google Fonts requests (the offline test) are expected network errors, not app errors.
  const consoleProblems = () => events
    .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(`${e.params.entry.url} ${e.params.entry.text}`)))
    .map((e) => JSON.stringify(e.params).slice(0, 300));

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Network.enable');

  const close = () => {
    ws.close();
    proc.kill('SIGKILL');
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  return { send, evaluate, click, screenshot, consoleProblems, close };
}
