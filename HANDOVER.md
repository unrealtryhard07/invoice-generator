# Invoice Studio — Handover

Start a new session with: **"Read ~/invoice-generator/HANDOVER.md and continue."**

Last updated: 2026-09-19

---

## 1. What this is

A bilingual (English / Arabic) invoicing app for **Nayef Bashar Trading Est.** (مؤسسة نايف بشر تجارية) — a logistics business offering customs clearance, import & export, ocean / air / land freight, supply chain management and commission-agent services, **globally** (head office in Kuwait; do not treat it as Kuwait-only).

- Vanilla HTML/CSS/JS. **No build step, no server, no framework.**
- Open `~/invoice-generator/index.html` directly in Chrome (works from `file://`).
- All data lives in the user's browser on this Mac.
- Reference invoice the design came from: `~/Downloads/Standard Invoice Cura Final.pdf` (GAC Kuwait proforma, KWD 3 decimals).

## 2. Run & test

```bash
open ~/invoice-generator/index.html                      # use the app
cd ~/invoice-generator && node --test tests/*.test.js    # 38 unit tests, all passing
cd ~/invoice-generator && node tests/e2e/smoke.mjs        # 38 end-to-end checks in headless Chrome (~1 min)
```

- Unit tests cover the pure modules (`calc`, `words`, `words-ar`, `ledger`, `documents`) and, via `tests/helpers/browser-env.js` (a `vm` sandbox with in-memory localStorage), `defaults` and `store`.
- `tests/e2e/smoke.mjs` drives the real app over the DevTools protocol (`tests/e2e/cdp.mjs`, throwaway Chrome profile, never your data): every view, numbering, credit notes, payments, delete guards, paste, attachments, 375px layout, PDF online and offline. Artifacts go to `tests/e2e/.artifacts/` (gitignored). Set a field with an `input` event (plus `change` for selects) — the editor listens to `input`.
- The project is a **git repo** since 2026-09-19 (baseline commit `a6a9d88` = the app before the audit fixes).
- The Playwright MCP bridge is **not** installed. Headless Chrome CLI (`--screenshot`) writes files but the process doesn't exit on its own — kill it.

## 3. Architecture

Every script is a classic `<script>` (not ES modules — modules break on `file://`) that attaches to `window.NB`. Pure modules use a UMD wrapper so Node tests can `require()` them.

**Load order (index.html):**

| # | File | Role |
|---|------|------|
| 1 | `vendor/qrcode.js` | qrcode-generator 1.4.4 (MIT) |
| 2 | `assets/embedded.js` | Logo + stamp as data URLs (`NB.embedded`) so PDF export works on `file://` |
| 3 | `js/calc.js` | Money math, rounding, totals, `profit()`, number/date formatting — UMD, tested |
| 4 | `js/words.js` | English amount in words ("KUWAIT, DINARS … FILS ONLY") — UMD, tested |
| 5 | `js/words-ar.js` | Arabic amount in words ("فقط … لا غير"), Arabic-Indic digits — UMD, tested |
| 6 | `js/ledger.js` | Status (draft/unpaid/partial/overdue/paid/converted/credit…), statements, ageing, customer balances, `prepare()` (credit notes), `dashboard()` — UMD, tested |
| 7 | `js/documents.js` | Doc types & conversion chain, containers (ISO 6346 check digit), FX equivalent, `qrPayload()` / `qrSvg()` — UMD, tested |
| 8 | `js/defaults.js` | Currencies (+Arabic names), Arabic label dictionary, theme presets, saved-charge seed, templates, `defaultBrand()`, `migrate()`, `newInvoice()`, `sampleInvoice()`, `applyTemplate()` |
| 9 | `js/store.js` | localStorage: invoices, brand defaults, clients, catalog, templates, settings/numbering, images, prefs, export/import |
| 10 | `js/blobs.js` | IndexedDB `nb-invoice-files`: attachments (`files`) and uploaded fonts (`fonts`) |
| 11 | `js/render.js` | Invoice → HTML (EN / AR RTL / bilingual), layout blocks, containers table, FX line, stamp, QR. **All user text escaped via `esc()`** |
| 12 | `js/statement.js` | Statement-of-account sheet |
| 13 | `js/ui.js` | Form builders bound to state paths (`data-path`), icons, status pills, HUD toast, `confirmTwice()` |
| 14 | `js/canvas.js` | Preview canvas: zoom, draggable/resizable movables (`[data-movable="stamp"]`, `[data-movable="qr"]`), Arrange mode (reorder blocks, resize columns) |
| 15 | `js/editor.js` | Inspector with tabs Document / Items / Payments / Files / Style; saved-charge combobox |
| 16 | `js/views.js` | Invoice list, Customers + statements, Saved Charges, Settings |
| 17 | `js/dashboard.js` | KPIs, monthly invoiced-vs-collected SVG chart, top customers, ageing |
| 18 | `js/pdf.js` | One-click PDF: lazy-loads `vendor/html-to-image.js` (1.11.13) + `vendor/jspdf.umd.min.js` (2.5.2) |
| 19 | `js/app.js` | Hash router, immutable state (`setIn`), autosave, commands, printing, wiring |

CSS: `css/app.css` (macOS-style shell, light/dark), `css/views.css` (lists, dashboard, dialogs, inspector extras), `css/invoice.css` (the printable sheet).

**Routes:** `#/dashboard`, `#/invoices`, `#/invoice/<id>`, `#/customers/<key>`, `#/charges`, `#/settings`.

**State flow:** `app.js` owns `state` (the open invoice). Editor and canvas call `ctx.set(path, value, structural)`; structural changes re-render the inspector. The preview re-renders on `requestAnimationFrame`. Autosave to localStorage runs 450 ms after a change (only once the invoice has content). List views read `ledgerInvoices()` = `ledger.prepare(migrated list)`.

## 4. Data model & storage

**localStorage keys (`nbinv.*`):** `invoices` (id → invoice), `brand` (defaults for new invoices), `clients`, `catalog`, `templates`, `settings` (`prefix, pattern, pad, next, baseCurrency, backupFiles`), `prefs` (zoom, tab, lastId, migratedDraft), `asset.logo`, `asset.stamp` (data URLs), legacy `draft`.

**IndexedDB `nb-invoice-files`:** `files{id, invoiceId, name, type, size, kind, addedAt, blob}`, `fonts{id, family, name, blob}`.

**Invoice (main fields):**
```
id, number, docType, status ('draft'|'sent'|'cancelled'), title, titleAr, language ('en'|'ar'|'bi')
company{name,nameAr,address,addressAr,contacts[],tagline,logo}, customer{name,nameAr,address,addressAr,contacts[]}
meta[{label,labelAr,value,type,key}]          // key 'invoiceDate' / 'dueDate', dates ISO YYYY-MM-DD
shipment[{label,labelAr,value,type,wide}], containers[{id,number,seal,size,packages,weight,volume}]
items[{id,desc,descAr,uom,qty,price,cost,discount,tax}], columns[{key,label,labelAr,visible,width}]
totals{discountType,discountValue,taxRate,charges[],…labels EN/AR}, payments[{id,date,amount,method,reference}]
currency{code,decimals,major,minor,country,majorAr,minorAr}, fx{enabled,base,baseDecimals,rate}
words{template,minorTemplate,casing,templateAr,minorTemplateAr}, footer{…EN/AR}, bank[]
sections{…booleans}, theme{colors, fonts, layout options…}, layout[blockIds]
stamp{show,source,x,y,size,rotation,opacity}                  // positions in mm
qr{show,mode:'summary'|'bank'|'custom',text,x,y,size,caption,captionAr}
supersededBy / convertedFrom / creditFor (+ …Number), createdAt, updatedAt
```

**Migration:** `defaults.migrate()` upgrades any older saved invoice (Arabic labels, meta keys, payments from legacy `totals.paid`, layout, containers, fx, qr, preset "Navy & Gold" → "Navy & Black"). Always pass loaded invoices through it.

## 5. What's built

- **Base:** GAC-style proforma layout, KWD 3-decimal math, amount in words, 12 currencies, full design customisation, auto numbering, saved clients, JSON backup/import.
- **Phase 1:** Arabic / bilingual / RTL invoices; payments with automatic Paid and Overdue; customer statements with ageing; saved charges with type-ahead; draggable stamp with a toolbar tick box; macOS-style UI with light/dark mode and autosave.
- **Phase 2:** dashboard (base currency); quotation → proforma → tax invoice conversion; credit notes linked to originals; container table with ISO check digit; exchange-rate equivalent; line cost & profit (internal only); attachments; templates (Freight Proforma, Commission Invoice, Simple Invoice, Quotation + user templates); Arrange mode (drag sections, resize columns); custom font upload.
- **Latest:** Download PDF button (⇧⌘D) with row-safe page breaks; draggable QR code (invoice summary / bank details / custom text), verified to decode.

## 6. Decisions & gotchas

- **Classic scripts only.** Don't convert to ES modules or add a bundler without the user agreeing — it breaks double-click opening.
- **PDF pages are raster images** (html-to-image → JPEG → jsPDF), ~900 KB/page, text not selectable. "Print / PDF" remains for vector output. The first download per session fetches Google font files (needs internet); only families in use are embedded.
- **Default logo/stamp come from `assets/embedded.js`**, not the PNGs, to avoid tainted canvases on `file://`. If `assets/logo.png` or `assets/stamp.png` changes, regenerate `embedded.js` (base64 data URLs).
- **`assets/stamp.png`** was produced from the user's scanned stamp (paper removed, blue ink kept, cropped) with Pillow in a throwaway venv.
- **Credit notes** are applied as *virtual payments* by `ledger.prepare()`; the credit note gets `appliedTo`. Never save prepared invoices.
- **Converting** a document moves its payments to the new document and marks the source `supersededBy` (status "Converted", excluded from ledger totals).
- **Global `svg { stroke… }` rule in `css/app.css`** outlines any inline SVG. Invoice QR, dashboard charts and similar graphics must set `stroke: none` explicitly.
- **Clickable overlays:** decorative layers over controls need `pointer-events: none` (the `.switch i` track once swallowed every inspector toggle click). `.canvas-scroll` has `isolation: isolate` so the sheet's z-indexed blocks/stamp/QR can't cover the zoom/Arrange pill — keep it. Verify UI fixes with real `Input.dispatchMouseEvent` clicks, not `el.click()` (that bypasses hit-testing and hid both bugs).
- **Stamp and QR default positions** are absolute mm on the sheet and can sit over content on long invoices; the user drags them into place.
- **GateGuard hook (ECC plugin)** blocks the first Write/Edit of each file and the first Bash of a session until you state facts (callers, overlap, data, the user's instruction), then you retry. Destructive commands (`rm`) also require a rollback line.
- **Cost:** the previous session was very expensive (about $450+ across this app and the website). The user chose phased delivery — propose scope and check in before large builds.

### Audit fixes (2026-09-19)
- **Numbering:** settings are always read from storage (never cached in `app.js`). `store.consumeNumber()` skips numbers already used; `releaseNumber()` hands back the number of a new document abandoned without content; the editor warns on a duplicate number; importing a single invoice with a used number renumbers it.
- **Backups:** import keeps the newer copy of each document (by `updatedAt`) and never rewinds `settings.next`. Settings → Backup shows storage used (warning at 80%) and an "Include attachments and fonts" option (`settings.backupFiles`; files travel as data URLs via `blobs.exportAll/importAll`).
- **Document type is stored** as `docType` (ids in `documents.DOC_TYPES`, plus `custom`). `defaults.mergeBrand/migrate` infer it once from the title for older data (`documents.inferDocType`); after that the title is free text. `ledger.documentKind` and `documents.typeOf` read `docType`.
- **Money:** status `overpaid` (balance below zero); "Mark as fully paid" uses the balance after credit notes; "Record payment" starts empty; fixed discount capped at the subtotal; a credit note defaults to the open balance (single line when part-settled) and is refused when nothing is owed.
- **Links:** converting keeps payment terms (due date shifts with the new issue date); `documents.deleteBlocker` stops deleting a converted copy whose original exists or an invoice with live credit notes.
- **Other:** PDF falls back to local fonts offline (toast says so); HTML/SVG/XML attachments download instead of opening; IndexedDB transactions reject on abort; paste accepts `717,5` and keeps `|` inside descriptions; statements use the saved default design; phone layout has no sideways scroll; one-dinar Arabic wording is `دينار كويتي واحد`.
- Found while testing: `ui.row/stack` gave controls that already had an `id` a second one, so "Paste Many Lines" never worked (`#bulk-items` was unreachable). `ui.labelled()` now reuses an existing id.

## 7. Known gaps / user to-dos

- Company address, phone, email, website and **bank details are placeholders** (`Block __`, `+965 ____`). User fills them in, then Style → "Use this design and wording for new invoices".
- **Arabic wording** written by Claude (customer name translation, charge names, terms) needs the user's review. Amounts of exactly 2 still read "اثنان دينار" (the dual form "ديناران" would need a dual name per currency).
- **JSON backups exclude attachments and uploaded fonts** (they live only in IndexedDB).
- All data exists only in this browser — clearing site data deletes it.
- Long shipment values wrap slightly in bilingual mode.

## 8. Backlog (not built)

Recommended order first:
1. **Cloud sync** (e.g. Supabase — a Supabase connector is available) — the biggest data-loss risk today.
2. Email / WhatsApp sharing with the PDF attached.
3. Excel/CSV export of the invoice list.
4. Batch export of a month's PDFs as a ZIP.
5. Letterhead background image.
6. User logins & roles; edit history; automatic backups.
7. Recurring invoices; payment reminders; fill an invoice from an email or PDF.

## 9. User preferences

- Wants **Apple-level polish** and a "multi-billion logistics company" feel; rejects generic or editorial-template looks.
- The business is **global** — never frame it as Kuwait-only.
- Prefers **phased delivery** with a cost check-in; when they say "just this, nothing else", keep scope exactly to that.
- No fabricated stats, clients, testimonials or certifications.
- Global rules in `~/.claude/rules/ecc/` apply (immutability, small focused files, tests, no `console.log`, escape all user input).

## 10. Related project

Company website: `~/nb-website` — static bilingual site with an interactive dotted globe. Contact placeholders are in `~/nb-website/js/i18n.js` (`window.SITE`). Not deployed yet (a Vercel connector is available; ask before publishing).
