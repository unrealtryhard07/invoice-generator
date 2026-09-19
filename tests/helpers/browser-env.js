/* Loads the browser-only modules (defaults, store, …) into a sandbox with an in-memory localStorage. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = ['vendor/qrcode.js', 'js/calc.js', 'js/words.js', 'js/words-ar.js', 'js/ledger.js', 'js/documents.js', 'js/defaults.js', 'js/store.js'];

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

/** Returns a fresh NB namespace backed by its own localStorage. */
function loadApp(initialStorage = {}) {
  const sandbox = { localStorage: memoryStorage(initialStorage), structuredClone, console, Date, Math, JSON };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  SCRIPTS.forEach((file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file }));
  return { NB: sandbox.NB, localStorage: sandbox.localStorage };
}

module.exports = { loadApp };
