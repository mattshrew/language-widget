// Local tests for dist/Word of the Day.js. Stubs the Scriptable API, runs the script
// for every widget family × language, and checks the daily-pick logic and data files.
// Run: node test/harness.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SOURCE = fs.readFileSync(path.join(DIST, "Word of the Day.js"), "utf8");
const DATA = {
  zh: JSON.parse(fs.readFileSync(path.join(DIST, "word-of-the-day/zh.json"), "utf8")),
  ko: JSON.parse(fs.readFileSync(path.join(DIST, "word-of-the-day/ko.json"), "utf8")),
};

let failures = 0, passes = 0;
function check(cond, msg) {
  if (cond) passes++;
  else { failures++; console.error("  FAIL:", msg); }
}

// ---------- Scriptable API stubs ----------

class Color {
  constructor(hex, alpha = 1) { this.hex = hex; this.alpha = alpha; }
  static dynamic(light, dark) { const c = new Color(light.hex); c.dark = dark.hex; return c; }
}
class Size { constructor(w, h) { this.width = w; this.height = h; } }
const Font = new Proxy({}, { get: (_, name) => (size) => ({ name, size }) });

class WidgetText {
  constructor(text) { this.type = "text"; this.text = text; }
  centerAlignText() { this.align = "center"; }
  leftAlignText() { this.align = "left"; }
  rightAlignText() { this.align = "right"; }
}
class WidgetStack {
  constructor() { this.type = "stack"; this.items = []; }
  addText(s) {
    if (typeof s !== "string") throw new TypeError(`addText expects a string, got ${typeof s}`);
    const t = new WidgetText(s); this.items.push(t); return t;
  }
  addStack() { const s = new WidgetStack(); this.items.push(s); return s; }
  addSpacer(len) { this.items.push({ type: "spacer", len }); }
  layoutHorizontally() { this.layout = "h"; }
  layoutVertically() { this.layout = "v"; }
  centerAlignContent() {}
  topAlignContent() {}
  setPadding(...p) { this.padding = p; }
  texts() { return this.items.flatMap((i) => (i.type === "text" ? [i] : i.items ? i.texts() : [])); }
}
class ListWidget extends WidgetStack {
  constructor() { super(); this.presented = null; }
  async presentSmall() { this.presented = "small"; }
  async presentMedium() { this.presented = "medium"; }
  async presentLarge() { this.presented = "large"; }
  async presentAccessoryRectangular() { this.presented = "accessoryRectangular"; }
}
class DateFormatter { string(d) { return d.toDateString(); } }

function fakeFileManager(docsDir) {
  const fm = {
    documentsDirectory: () => docsDir,
    joinPath: (a, b) => path.join(a, b),
    fileExists: (p) => fs.existsSync(p),
    isFileStoredIniCloud: () => true,
    isFileDownloaded: () => false,
    downloadFileFromiCloud: async () => { fm.downloads++; },
    readString: (p) => fs.readFileSync(p, "utf8"),
    downloads: 0,
  };
  return fm;
}

/** Run the whole script in a fresh sandbox; returns what it drew/presented. */
async function runScript({ family = "small", param = null, runsInWidget = true, now, docsDir = DIST, sheetChoice = -1, test = false }) {
  const out = { widget: null, completed: false, alerts: [], fm: fakeFileManager(docsDir), presented: [] };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now ? now.getTime() : RealDate.now()])); }
    static now() { return now ? now.getTime() : RealDate.now(); }
  }
  class Alert {
    constructor() { this.actions = []; out.alerts.push(this); }
    addAction(t) { this.actions.push(t); }
    addCancelAction(t) { this.cancel = t; }
    async presentSheet() { return sheetChoice; }
    async presentAlert() { return sheetChoice; }
  }
  class TrackedListWidget extends ListWidget {
    async presentSmall() { out.presented.push("small"); }
    async presentMedium() { out.presented.push("medium"); }
    async presentAccessoryRectangular() { out.presented.push("accessoryRectangular"); }
  }
  const module = { exports: {} };
  const sandbox = {
    Date: FakeDate, Math, JSON, Array, String, Number, Object, Error, TypeError, Promise, console,
    Color, Size, Font, ListWidget: TrackedListWidget, DateFormatter, Alert,
    FileManager: { iCloud: () => out.fm, local: () => out.fm },
    config: { widgetFamily: runsInWidget ? family : null, runsInWidget, runsInApp: !runsInWidget },
    args: { widgetParameter: param },
    Script: { setWidget: (w) => { out.widget = w; }, complete: () => { out.completed = true; } },
    module,
  };
  if (test) sandbox.WOTD_TEST = true;
  vm.createContext(sandbox);
  await vm.runInContext(`(async () => {\n${SOURCE}\n})()`, sandbox, { filename: "Word of the Day.js" });
  out.exports = module.exports;
  return out;
}

const withTZ = (tz, fn) => { const old = process.env.TZ; process.env.TZ = tz; try { return fn(); } finally { process.env.TZ = old; } };

// ---------- 1. every family × parameter renders ----------
console.log("Widget rendering");
const FAMILIES = ["small", "medium", "large", "extraLarge", "accessoryRectangular", "accessoryInline", "accessoryCircular"];
const PARAMS = [null, "", "zh", "ko", "KO ", "both", "nonsense"];
const NOW = new Date(2026, 10, 15, 9, 30);
for (const family of FAMILIES) {
  for (const param of PARAMS) {
    const label = `${family} / ${JSON.stringify(param)}`;
    let r;
    try { r = await runScript({ family, param, now: NOW }); }
    catch (e) { check(false, `${label} threw: ${e.stack}`); continue; }
    check(r.widget && r.completed, `${label}: setWidget + complete`);
    const text = r.widget.texts().map((t) => t.text).join(" | ");
    const roomy = ["medium", "large", "extraLarge"].includes(family);
    const want = String(param ?? "").trim().toLowerCase() === "ko" ? ["ko"]
      : param === "both" && roomy ? ["zh", "ko"] : ["zh"];
    for (const lang of want) {
      const e = r.exports.pickWord(DATA[lang], lang, NOW);
      check(text.includes(e.word), `${label}: shows ${lang} word ${e.word} (got: ${text})`);
      if (family !== "accessoryCircular") check(text.includes(e.reading), `${label}: shows reading ${e.reading}`);
      if (family === "accessoryInline") check(text.includes(e.def.split(";")[0]), `${label}: inline shows first sense`);
      else if (family !== "accessoryCircular") check(text.includes(e.def), `${label}: shows definition`);
    }
    if (family === "accessoryInline") check(r.widget.texts().length === 1, `${label}: inline has exactly one text`);
    const next = new Date(2026, 10, 16, 0, 0, 5);
    check(r.widget.refreshAfterDate?.getTime() === next.getTime(), `${label}: refreshes at next local midnight`);
  }
}

// ---------- 2. daily pick logic ----------
console.log("Daily pick");
const { exports: L } = await runScript({ test: true });
for (const lang of ["zh", "ko"]) {
  const list = DATA[lang], n = list.length;
  const a = L.pickWord(list, lang, new Date(2026, 4, 1, 8));
  const b = L.pickWord(list, lang, new Date(2026, 4, 1, 22));
  const c = L.pickWord(list, lang, new Date(2026, 4, 2, 8));
  check(a === b, `${lang}: same word all day`);
  check(a !== c, `${lang}: different word the next day`);

  // every word exactly once per cycle, for the first two cycles
  for (const cycle of [0, 1]) {
    const words = new Set();
    for (let d = 0; d < n; d++) words.add(list.indexOf(L.pickWord(list, lang, new Date(2026, 0, 1 + cycle * n + d, 12))));
    check(words.size === n, `${lang}: cycle ${cycle} shows all ${n} words once (got ${words.size})`);
  }
  // consecutive days aren't neighbours in the source order (shuffled)
  let adjacent = 0;
  for (let d = 0; d < 200; d++) {
    const i = list.indexOf(L.pickWord(list, lang, new Date(2026, 0, 1 + d, 12)));
    const j = list.indexOf(L.pickWord(list, lang, new Date(2026, 0, 2 + d, 12)));
    if (Math.abs(i - j) === 1) adjacent++;
  }
  check(adjacent < 5, `${lang}: order is shuffled (${adjacent}/200 adjacent pairs)`);
  // dates before the start date still work
  check(!!L.pickWord(list, lang, new Date(2025, 5, 1)), `${lang}: works before start date`);
}
check(L.pickWord(DATA.zh, "zh", NOW) !== L.pickWord(DATA.ko, "ko", NOW) , "zh and ko pick independently");

// ---------- 3. local midnight & time zones ----------
console.log("Midnight / time zones");
for (const tz of ["America/Toronto", "Asia/Seoul", "Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
  withTZ(tz, () => {
    const before = new Date(2026, 10, 15, 23, 59, 59);
    const after = new Date(2026, 10, 16, 0, 0, 1);
    const morning = new Date(2026, 10, 15, 0, 0, 1);
    check(L.localDayIndex(after) === L.localDayIndex(before) + 1, `${tz}: day changes at local midnight`);
    check(L.localDayIndex(morning) === L.localDayIndex(before), `${tz}: same day from 00:00 to 23:59`);
    // DST transitions: consecutive calendar days stay consecutive
    for (const [y, m, d] of [[2026, 2, 8], [2026, 10, 1], [2026, 2, 29], [2026, 9, 25]]) {
      const x = L.localDayIndex(new Date(y, m, d, 12));
      check(L.localDayIndex(new Date(y, m, d + 1, 12)) === x + 1, `${tz}: DST-safe around ${y}-${m + 1}-${d}`);
    }
    check(L.nextMidnight(before).getDate() === 16 && L.nextMidnight(before).getHours() === 0, `${tz}: nextMidnight`);
  });
}
check(L.localDayIndex(new Date(2026, 0, 1, 0, 0, 1)) === 0, "start date is day 0");

// ---------- 4. errors, iCloud, in-app ----------
console.log("Errors / iCloud / in-app");
{
  const empty = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "wotd-"));
  for (const family of ["small", "medium", "accessoryRectangular", "accessoryInline"]) {
    const r = await runScript({ family, param: "ko", now: NOW, docsDir: empty });
    const text = r.widget.texts().map((t) => t.text).join(" ");
    check(r.completed && /Missing|setup needed/.test(text), `${family}: missing data shows error widget (${text})`);
  }
  fs.mkdirSync(path.join(empty, "word-of-the-day"));
  fs.writeFileSync(path.join(empty, "word-of-the-day/zh.json"), "{not json");
  const bad = await runScript({ family: "small", param: "zh", now: NOW, docsDir: empty });
  check(/valid JSON/.test(bad.widget.texts().map((t) => t.text).join(" ")), "invalid JSON shows error widget");
  fs.rmSync(empty, { recursive: true });

  const r = await runScript({ family: "small", param: "zh", now: NOW });
  check(r.fm.downloads >= 1, "downloads data from iCloud before reading");

  for (const [choice, expect] of [[-1, []], [0, ["small"]], [1, ["medium"]], [2, ["accessoryRectangular"]]]) {
    const app = await runScript({ runsInWidget: false, now: NOW, sheetChoice: choice });
    check(app.alerts.length === 1 && /中文[\s\S]*한국어/.test(app.alerts[0].message), `in-app: alert lists both languages`);
    check(JSON.stringify(app.presented) === JSON.stringify(expect), `in-app choice ${choice} presents ${expect} (got ${app.presented})`);
    check(app.completed, "in-app: completes");
  }
}

// ---------- 5. data files ----------
console.log("Data files");
const PINYIN = /^[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜĀÁǍÀĒÉĚÈŌÓǑÒ'·\- ]+$/;
const TONED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈŌÓǑÒ]/;
const ROMAN = /^[a-zA-Z'\- ]+$/;
for (const [lang, list] of Object.entries(DATA)) {
  const bad = list.filter((e) => !["word", "reading", "def", "level"].every((k) => typeof e[k] === "string" && e[k].trim()));
  check(bad.length === 0, `${lang}: every entry has word/reading/def/level (${bad.length} bad: ${JSON.stringify(bad.slice(0, 3))})`);
  const long = list.filter((e) => e.def.length > 60);
  check(long.length === 0, `${lang}: definitions ≤ 60 chars (${long.length} too long)`);
  const dupes = list.length - new Set(list.map((e) => e.word + "|" + e.def)).size;
  check(dupes === 0, `${lang}: no duplicate entries (${dupes})`);
  if (lang === "zh") {
    const badPy = list.filter((e) => !PINYIN.test(e.reading));
    check(badPy.length === 0, `zh: readings are pinyin (${badPy.slice(0, 5).map((e) => e.word + " " + e.reading)})`);
    const toned = list.filter((e) => TONED.test(e.reading)).length / list.length;
    check(toned > 0.97, `zh: ${(toned * 100).toFixed(1)}% of readings have tone marks`);
    check(list.every((e) => /[一-鿿]/.test(e.word)), "zh: words are Chinese characters");
  } else {
    const badRo = list.filter((e) => !ROMAN.test(e.reading));
    check(badRo.length === 0, `ko: readings are Latin-only (${badRo.slice(0, 5).map((e) => e.word + " " + e.reading)})`);
    check(list.every((e) => /[가-힣]/.test(e.word)), "ko: words are Hangul");
  }
  console.log(`  ${lang}: ${list.length} words`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
