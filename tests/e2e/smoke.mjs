// End-to-end regression suite for the 2026-09-19 audit fixes. Run: node tests/e2e/smoke.mjs
import { launch, sleep, ARTIFACTS } from './cdp.mjs';

const APP = new URL('../../index.html', import.meta.url).href;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

const b = await launch();
const { evaluate: ev, click, send } = b;
const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(450); };
// Sets a field the way a browser does for a real user: an `input` event, then `change` for selects.
const type = async (selector, value) => {
  await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error(${JSON.stringify(`missing ${selector}`)});
    el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input', { bubbles: true }));
    if (el.tagName === 'SELECT') el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(150);
};
const toast = () => ev(`document.getElementById('toast').textContent`);
const nextSeq = () => ev('NB.store.loadSettings().next');
const openNew = async () => {
  await go('#/invoices');
  await click('.sidebar-new');
  await click('#template-grid [data-template=""]');
  await sleep(300);
  return ev('location.hash.split("/")[2]');
};
const tab = (name) => click(`[data-tab="${name}"]`);
const ledgerView = (id, expr) => ev(`(() => { const all = NB.ledger.prepare(NB.store.listInvoices().map(NB.defaults.migrate));
  const inv = all.find((x) => x.id === ${JSON.stringify(id)}); return ${expr}; })()`);
const status = (id) => ledgerView(id, 'NB.ledger.status(inv, NB.defaults.today())');
const balance = (id) => ledgerView(id, 'NB.calc.computeTotals(inv).balance');
const waitForPdf = async () => {
  for (let i = 0; i < 60 && (await ev('document.querySelector("#download-pdf span").textContent')) !== 'Download PDF'; i += 1) await sleep(500);
  return toast();
};

try {
  await send('Page.navigate', { url: APP });
  await sleep(2500);
  const sampleId = await ev('NB.store.listInvoices()[0].id');

  /* Boot and every view */
  for (const hash of ['#/dashboard', '#/invoices', '#/customers', '#/charges', '#/settings', `#/invoice/${sampleId}`]) {
    await go(hash);
    const visible = await ev(`[...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.dataset.view + ':' + v.innerText.length)`);
    check(`renders ${hash.split('/')[1]}`, visible.length === 1 && Number(visible[0].split(':')[1]) > 20, visible.join());
  }

  /* #1 Changing a setting no longer rewinds numbering */
  const a = await openNew();
  await type('[data-path="customer.name"]', 'NUMBERING TEST A');
  await sleep(600);
  await go('#/settings');
  await type('#set-base', 'USD');
  const bId = await openNew();
  await type('[data-path="customer.name"]', 'NUMBERING TEST B');
  await sleep(600);
  const numbers = await ev('NB.store.listInvoices().map((i) => i.number)');
  check('#1 no duplicate numbers after changing a setting', new Set(numbers).size === numbers.length, numbers.join(', '));
  await go('#/settings');
  await type('#set-base', 'KWD');

  /* #8 An abandoned new document hands its number back */
  const before = await nextSeq();
  await openNew();
  await go('#/invoices');
  const after = await nextSeq();
  check('#8 abandoned new document returns its number', after === before, `next before ${before}, after ${after}`);

  /* #8 Duplicate number warning in the editor */
  await go(`#/invoice/${bId}`);
  await tab('document');
  const aNumber = await ev(`NB.store.getInvoice(${JSON.stringify(a)}).number`);
  await type('[data-path="number"]', aNumber);
  check('#8 warns when a number is already used', !(await ev('document.querySelector("[data-number-warning]").hidden')));
  await type('[data-path="number"]', `${aNumber}-B`);
  check('#8 warning clears for a unique number', await ev('document.querySelector("[data-number-warning]").hidden'));

  /* #15 Record payment starts empty; #6 credit note defaults to what is owed; #2 Mark as fully paid settles exactly */
  await go(`#/invoice/${sampleId}`);
  await tab('payments');
  await click('[data-act="pay-add"]');
  const emptyAmount = await ev('document.querySelector("[data-path=\\"payments.0.amount\\"]").value');
  check('#15 "Record payment" starts with an empty amount', emptyAmount === '', `value "${emptyAmount}"`);
  await type('[data-path="payments.0.amount"]', '1000');
  await sleep(600);
  await tab('document');
  await click('[data-act="convert"][data-target="credit"]');
  await sleep(600);
  const creditId = await ev('location.hash.split("/")[2]');
  const creditTotal = await ev(`NB.calc.computeTotals(NB.defaults.migrate(NB.store.getInvoice(${JSON.stringify(creditId)}))).total`);
  check('#6 credit note defaults to the open balance (2,919.600)', creditTotal === 2919.6, `credit total ${creditTotal}`);
  await tab('items');
  await type('[data-path="items.0.price"]', '500');
  await tab('document');
  await type('[data-path="status"]', 'sent');
  await sleep(600);
  await go(`#/invoice/${sampleId}`);
  await tab('payments');
  const label = await ev('(document.querySelector("[data-act=\\"pay-full\\"]") || {}).textContent || ""');
  check('#2 button shows balance after credit (2,419.600)', label.includes('2,419.600'), label);
  await click('[data-act="pay-full"]');
  await sleep(600);
  check('#2 "Mark as fully paid" leaves a zero balance', (await balance(sampleId)) === 0, `balance ${await balance(sampleId)}`);
  check('#2 status is Paid, not Overpaid', (await status(sampleId)) === 'paid', await status(sampleId));

  /* #6 Overpayment is flagged */
  await type('[data-path="payments.1.amount"]', '9999');
  await sleep(600);
  check('#6 overpaid invoice shows Overpaid', (await status(sampleId)) === 'overpaid', await status(sampleId));
  await type('[data-path="payments.1.amount"]', '2419.6');
  await sleep(600);

  /* #5 Deleting a document with a live credit note is blocked */
  await go('#/invoices');
  await click(`[data-act="list-delete"][data-id="${sampleId}"]`);
  const deleteToast = await toast();
  const stillThere = await ev(`Boolean(NB.store.getInvoice(${JSON.stringify(sampleId)}))`);
  check('#5 delete blocked while a credit note exists', /credit note/i.test(deleteToast) && stillThere, deleteToast);

  /* #4 Converting keeps the payment terms */
  await go(`#/invoice/${bId}`);
  await tab('document');
  await click('[data-act="due"][data-days="30"]');
  await sleep(500);
  await click('[data-act="convert"][data-target="tax"]');
  await sleep(600);
  const taxId = await ev('location.hash.split("/")[2]');
  const dates = await ev(`(() => { const inv = NB.store.getInvoice(${JSON.stringify(taxId)}); return { issued: NB.ledger.invoiceDate(inv), due: NB.ledger.dueDate(inv) }; })()`);
  const expectedDue = await ev('NB.defaults.addDays(NB.defaults.today(), 30)');
  check('#4 converted document is due 30 days from its new date', dates.due === expectedDue, JSON.stringify(dates));
  await go('#/invoices');
  await click(`[data-act="list-delete"][data-id="${taxId}"]`);
  check('#5 delete of a converted copy is blocked', /Cancelled/.test(await toast()), await toast());

  /* #10 Title text no longer changes how a document is counted */
  await go(`#/invoice/${taxId}`);
  await tab('document');
  await type('[data-path="title"]', 'TAX INVOICE — QUOTE REF 7');
  await sleep(600);
  check('#10 renamed tax invoice still counts as an invoice', (await ev(`NB.ledger.documentKind(NB.store.getInvoice(${JSON.stringify(taxId)}))`)) === 'invoice');

  /* #17 Paste many lines */
  await tab('items');
  await type('#bulk-items', 'PORT CHARGES | 2 | 717,5\nTHC | DOC FEES | 1 | 10');
  await click('[data-act="bulk-add"]');
  const pasted = await ev(`NB.store.getInvoice(${JSON.stringify(taxId)}) && (() => { const items = document.querySelectorAll('[data-path^="items."][data-path$=".price"]'); return [...items].slice(-2).map((i) => i.value); })()`);
  const keptPipe = await ev('[...document.querySelectorAll("[data-path$=\\".desc\\"]")].some((t) => t.value === "THC | DOC FEES")');
  check('#17 "717,5" pasted as 717.5 and "|" kept in description', pasted[0] === '717.5' && keptPipe, `${pasted.join()} pipe:${keptPipe}`);

  /* #7 Oversized fixed discount is capped (checked on the rendered invoice) */
  await type('[data-path="totals.discountType"]', 'amount');
  await type('[data-path="totals.discountValue"]', '99999999');
  await sleep(400);
  const grand = await ev('document.querySelector(".canvas-host .inv-totals .is-grand td").textContent.trim()');
  check('#7 fixed discount never makes the total negative', !grand.startsWith('-'), grand);
  await type('[data-path="totals.discountValue"]', '0');

  /* #14 HTML attachments are downloaded, not opened */
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: ARTIFACTS });
  await ev(`NB.blobs.addFile(${JSON.stringify(taxId)}, new File(['<script>window.__pwned = 1<\\/script>'], 'evil.html', { type: 'text/html' }))`);
  await tab('files');
  await sleep(400);
  await click('[data-act="file-open"]');
  check('#14 HTML attachment is saved, not opened', /Downloads/.test(await toast()) && !(await ev('Boolean(window.__pwned)')), await toast());

  /* #16 Statement uses the saved default design, not the last opened invoice */
  await go(`#/invoice/${taxId}`);
  await click('#language-seg [data-lang="ar"]');
  await sleep(500);
  await go('#/customers');
  check('#16 statement keeps the default (bilingual) design', await ev('Boolean(document.querySelector("#statement-canvas .sheet.lang-bi"))'));

  /* #9 Storage meter and backup option */
  await go('#/settings');
  check('#9 storage meter shown in Settings', await ev('Boolean(document.querySelector(".storage-row [role=meter]"))'));
  check('#9 "Include attachments and fonts" option present', await ev('Boolean(document.querySelector("#set-backupFiles"))'));
  const backup = await ev('NB.blobs.exportAll().then((r) => ({ files: r.files.length, hasData: r.files.every((f) => f.data.startsWith("data:")) }))');
  check('#9 attachments can be exported with the backup', backup.files >= 1 && backup.hasData, JSON.stringify(backup));

  /* #11 Phone layout */
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  for (const hash of ['#/dashboard', '#/invoices', `#/invoice/${sampleId}`, '#/customers', '#/settings']) {
    await go(hash);
    const overflow = await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    check(`#11 no sideways scroll at 375px on ${hash.split('/')[1]}`, overflow <= 0, `${overflow}px`);
  }
  await go('#/dashboard');
  check('#11 dashboard figures are not truncated', await ev('[...document.querySelectorAll(".kpi-value")].every((el) => el.scrollWidth <= el.clientWidth + 1)'));
  check('#11 period buttons stay on one line', await ev('[...document.querySelectorAll("#dashboard-period button")].every((el) => el.getBoundingClientRect().height <= 30)'));
  await ev('NB.ui.toast("Layout check")');
  await sleep(300);
  check('#11 toast sits above the bottom navigation', await ev('document.getElementById("toast").getBoundingClientRect().bottom <= document.querySelector(".sidebar").getBoundingClientRect().top'));
  await b.screenshot('phone-dashboard.png');
  await send('Emulation.clearDeviceMetricsOverride');

  /* PDF: online, then offline fallback (#12) */
  await go(`#/invoice/${sampleId}`);
  await click('#download-pdf');
  const online = await waitForPdf();
  check('PDF downloads online with embedded fonts', /^Saved “.*” to your Downloads\.$/.test(online), online);
  await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
  await send('Page.reload');
  await sleep(2500);
  await go(`#/invoice/${sampleId}`);
  await click('#download-pdf');
  const offline = await waitForPdf();
  check('#12 PDF still downloads offline, with a notice', /offline/.test(offline), offline);

  const problems = b.consoleProblems();
  check('no console errors or exceptions', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (err) {
  check('suite ran to completion', false, err.stack || String(err));
} finally {
  b.close();
}

const failed = results.filter((r) => !r.ok);
results.forEach((r) => console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
