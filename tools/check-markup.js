#!/usr/bin/env node
/*
 * Keeps index.html and index.js in sync.
 *
 *   node tools/check-markup.js
 *
 * Scans index.js for every id it looks up and every data-* hook it delegates on,
 * then asserts that index.html really provides them. Catches the classic
 * "renamed an element, forgot the script" bug without needing a browser.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

const problems = [];

/* ids referenced from the script: $('#id'), getElementById('id') */
const idPatterns = [/\$\('#([A-Za-z0-9_-]+)'\)/g, /getElementById\('([A-Za-z0-9_-]+)'\)/g];
const wanted = new Set();
idPatterns.forEach((pattern) => {
  const matches = js.matchAll(pattern);
  for (const match of matches) wanted.add(match[1]);
});

const declared = new Set();
const idMatches = html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g);
for (const match of idMatches) declared.add(match[1]);

const missing = Array.from(wanted).filter((id) => !declared.has(id));
if (missing.length) problems.push('index.html is missing ids used by index.js: ' + missing.join(', '));

/* duplicate ids would make querySelector pick an arbitrary element */
const allIds = Array.from(html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)).map((m) => m[1]);
const duplicates = Array.from(new Set(allIds.filter((id, index) => allIds.indexOf(id) !== index)));
if (duplicates.length) problems.push('index.html has duplicate ids: ' + duplicates.join(', '));

/* every data-* hook the delegated click handler relies on */
/* Hooks that must exist in the static markup... */
const staticHooks = ['data-modal', 'data-open-report', 'data-close-modal'];
staticHooks.forEach((hook) => {
  if (html.indexOf(hook) === -1) problems.push(hook + ' is expected in index.html but is missing');
});

/* ...and hooks that index.js injects into its own markup at render time. */
const dynamicHooks = ['data-filter', 'data-action', 'data-animal-card', 'data-ticker', 'data-station'];
dynamicHooks.forEach((hook) => {
  const generatedInJs = js.indexOf(hook + '=\'') !== -1 || js.indexOf(hook + '="') !== -1;
  const delegated = js.indexOf('[' + hook + ']') !== -1;
  if (delegated && !generatedInJs && html.indexOf(hook) === -1) {
    problems.push(hook + ' is delegated in index.js but never rendered anywhere');
  }
});

/* assets the page loads must exist on disk */
const assets = Array.from(html.matchAll(/(?:src|href)="((?!https?:|\/\/|#)[^"]+)"/g)).map((m) => m[1]);
assets.forEach((asset) => {
  if (!fs.existsSync(path.join(ROOT, asset))) problems.push('index.html references a missing file: ' + asset);
});

/* the fallback dataset has to mirror data/animals.json */
const raw = path.join(ROOT, 'data', 'animals.json');
if (fs.existsSync(raw)) {
  const json = JSON.parse(fs.readFileSync(raw, 'utf8'));
  const inline = fs.readFileSync(path.join(ROOT, 'data', 'animals-data.js'), 'utf8');
  const embedded = JSON.parse(inline.slice(inline.indexOf('{'), inline.lastIndexOf('}') + 1));
  const sameAnimals = JSON.stringify(embedded.animals) === JSON.stringify(json.animals);
  const sameStations = JSON.stringify(embedded.stations) === JSON.stringify(json.stations);
  if (!sameAnimals || !sameStations) problems.push('data/animals-data.js is out of date - run: node tools/build-data.js');
}

/* ------------------------------------------------------------------ *
 * Static "did you typo a function name?" check for index.js.          *
 * node --check only validates syntax, so this walks every call site   *
 * and asserts the identifier is defined somewhere in the same file.   *
 * ------------------------------------------------------------------ */
const globals = new Set([
  'Set', 'Map', 'Date', 'Number', 'String', 'Boolean', 'Object', 'Array', 'JSON', 'Math',
  'Promise', 'Error', 'RegExp', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'require', 'console',
  'URLSearchParams', 'URL', 'FormData', 'Blob', 'File',
  // reserved keywords — never user-defined names, so the call-site regex may match them
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'do', 'else',
  'async', 'await', 'try', 'finally', 'delete', 'void', 'in', 'of', 'instanceof', 'yield',
  'throw', 'case', 'break', 'continue', 'default', 'extends', 'super', 'this', 'class', 'with'
]);

const definedNames = new Set();
Array.from(js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)).forEach((m) => definedNames.add(m[1]));
Array.from(js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)).forEach((m) => definedNames.add(m[1]));
Array.from(js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)).forEach((m) => definedNames.add(m[1]));
Array.from(js.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)).forEach((m) => definedNames.add(m[1]));

function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    const next = src[i + 1];

    // Single-line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }

    // Multi-line comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Single / double / template string literal
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < len) {
        if (src[i] === '\\') {
          i += 2; // skip escape sequence
        } else if (src[i] === quote) {
          i++;
          break;
        } else {
          i++;
        }
      }
      out += ' ';
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

const jsCodeOnly = stripCommentsAndStrings(js);

const calledNames = new Set();
Array.from(jsCodeOnly.matchAll(/([^.\w$'"])([A-Za-z_$][\w$]*)\s*\(/g)).forEach((m) => calledNames.add(m[2]));

const unknownCalls = Array.from(calledNames).filter((name) => !definedNames.has(name) && !globals.has(name));
const realUnknown = unknownCalls.filter((name) => name.length > 1 && !/^(o|s|a|b|d|e|k|m|v|x|n|t|r|f|p|q|w|i|j|u)$/.test(name));
if (realUnknown.length) {
  problems.push('index.js calls names that are never defined: ' + realUnknown.join(', '));
}

if (problems.length) {
  console.error('MARKUP CHECK FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('index.html, index.js and data/ are in sync.');
console.log('  ids referenced by index.js : ' + wanted.size);
console.log('  ids declared in index.html : ' + declared.size);
console.log('  local assets verified      : ' + assets.length);
