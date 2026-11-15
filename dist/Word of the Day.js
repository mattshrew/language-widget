// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: language;

// Word of the Day: one Chinese or Korean word per day.
// Widget Parameter: "zh" (default), "ko", or "both" (medium/large widgets).
// Data: iCloud Drive/Scriptable/word-of-the-day/{zh,ko}.json
//   [{ "word": "学习", "reading": "xuéxí", "def": "to learn; to study", "level": "HSK 1" }, ...]

const DATA_DIR = "word-of-the-day";
const START = { y: 2026, m: 0, d: 1 }; // day 0 (local calendar date)
const LANGS = {
  zh: { name: "中文", seed: 0x5eed2c, accent: ["#C8102E", "#FF6B6B"] },
  ko: { name: "한국어", seed: 0x5eed4b, accent: ["#0047A0", "#7AB0FF"] },
};

// ---------- pure logic (tested by test/harness.mjs) ----------

/** Whole days from START to `date`, by LOCAL calendar date (DST-safe). */
function localDayIndex(date) {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const start = Date.UTC(START.y, START.m, START.d);
  return Math.round((day - start) / 86400000);
}

/** Small deterministic PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle of [0..n-1] driven by `seed`. */
function seededPermutation(n, seed) {
  const rand = mulberry32(seed);
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/** Today's word: each pass through the list ("cycle") uses a fresh shuffle,
 *  so every word appears exactly once per cycle. */
function pickWord(list, lang, date) {
  const n = list.length;
  const day = localDayIndex(date);
  const cycle = Math.floor(day / n);
  const pos = ((day % n) + n) % n;
  const perm = seededPermutation(n, (LANGS[lang].seed + cycle * 7919) >>> 0);
  return list[perm[pos]];
}

/** Next local midnight (plus a few seconds of slack). */
function nextMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 5);
}

/** "zh" | "ko" | "both" from the widget parameter; "both" only where it fits. */
function parseLangs(param, family) {
  const p = String(param || "zh").trim().toLowerCase();
  const roomy = family === "medium" || family === "large" || family === "extraLarge";
  if (p === "both") return roomy ? ["zh", "ko"] : ["zh"];
  if (p === "ko" || p === "kr" || p === "korean") return ["ko"];
  return ["zh"];
}

// ---------- data ----------

async function loadList(lang) {
  let fm;
  try {
    fm = FileManager.iCloud();
  } catch (e) {
    fm = FileManager.local();
  }
  const path = fm.joinPath(fm.joinPath(fm.documentsDirectory(), DATA_DIR), `${lang}.json`);
  if (!fm.fileExists(path)) throw new Error(`Missing ${DATA_DIR}/${lang}.json in the Scriptable folder.`);
  if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(path) && !fm.isFileDownloaded(path)) {
    await fm.downloadFileFromiCloud(path);
  }
  let list;
  try {
    list = JSON.parse(fm.readString(path));
  } catch (e) {
    throw new Error(`${DATA_DIR}/${lang}.json isn't valid JSON.`);
  }
  if (!Array.isArray(list) || list.length === 0 || !list[0].word) {
    throw new Error(`${DATA_DIR}/${lang}.json has no words.`);
  }
  return list;
}

// ---------- drawing ----------

const C = {
  bg: Color.dynamic(new Color("#FFFDF8"), new Color("#1C1C1E")),
  text: Color.dynamic(new Color("#1C1C1E"), new Color("#F2F2F7")),
  dim: Color.dynamic(new Color("#6E6E73"), new Color("#A1A1A6")),
};
const accent = (lang) => Color.dynamic(new Color(LANGS[lang].accent[0]), new Color(LANGS[lang].accent[1]));

function addText(stack, str, font, color, opts = {}) {
  const t = stack.addText(str);
  t.font = font;
  if (color) t.textColor = color;
  if (opts.lines) t.lineLimit = opts.lines;
  if (opts.scale) t.minimumScaleFactor = opts.scale;
  if (opts.center) t.centerAlignText();
  return t;
}

function tag(stack, lang, entry, size = 11) {
  addText(stack, `${LANGS[lang].name} · ${entry.level || ""}`.replace(/ · $/, ""),
    Font.semiboldSystemFont(size), accent(lang), { lines: 1, scale: 0.7 });
}

function drawSmall(w, lang, e) {
  tag(w, lang, e);
  w.addSpacer();
  addText(w, e.word, Font.boldSystemFont(34), C.text, { lines: 1, scale: 0.4 });
  addText(w, e.reading, Font.mediumSystemFont(15), accent(lang), { lines: 1, scale: 0.6 });
  w.addSpacer(4);
  addText(w, e.def, Font.systemFont(12), C.dim, { lines: 3, scale: 0.85 });
  w.addSpacer();
}

function drawMediumSingle(w, lang, e) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const left = row.addStack();
  left.layoutVertically();
  left.size = new Size(135, 0);
  tag(left, lang, e);
  left.addSpacer(4);
  addText(left, e.word, Font.boldSystemFont(42), C.text, { lines: 1, scale: 0.35 });
  addText(left, e.reading, Font.mediumSystemFont(16), accent(lang), { lines: 1, scale: 0.6 });
  row.addSpacer(14);
  const right = row.addStack();
  right.layoutVertically();
  addText(right, e.def, Font.systemFont(15), C.text, { lines: 5, scale: 0.75 });
  row.addSpacer();
}

function drawColumn(stack, lang, e, wordSize, defLines) {
  const col = stack.addStack();
  col.layoutVertically();
  tag(col, lang, e, 10);
  col.addSpacer(2);
  addText(col, e.word, Font.boldSystemFont(wordSize), C.text, { lines: 1, scale: 0.35 });
  addText(col, e.reading, Font.mediumSystemFont(13), accent(lang), { lines: 1, scale: 0.6 });
  col.addSpacer(3);
  addText(col, e.def, Font.systemFont(12), C.dim, { lines: defLines, scale: 0.8 });
  col.addSpacer();
  return col;
}

function drawMediumBoth(w, picks) {
  const row = w.addStack();
  row.layoutHorizontally();
  picks.forEach(([lang, e], i) => {
    if (i) row.addSpacer(12);
    drawColumn(row, lang, e, 30, 2);
  });
}

function drawLargeBlock(stack, lang, e, wordSize, defLines) {
  tag(stack, lang, e, 13);
  stack.addSpacer(4);
  addText(stack, e.word, Font.boldSystemFont(wordSize), C.text, { lines: 1, scale: 0.35 });
  addText(stack, e.reading, Font.mediumSystemFont(wordSize * 0.36), accent(lang), { lines: 1, scale: 0.6 });
  stack.addSpacer(8);
  addText(stack, e.def, Font.systemFont(17), C.text, { lines: defLines, scale: 0.8 });
}

function drawLarge(w, picks, date) {
  picks.forEach(([lang, e], i) => {
    if (i) w.addSpacer(16);
    drawLargeBlock(w, lang, e, picks.length > 1 ? 44 : 60, picks.length > 1 ? 2 : 5);
  });
  w.addSpacer();
  const df = new DateFormatter();
  df.dateFormat = "EEEE, MMM d";
  addText(w, `Word of the day · ${df.string(date)}`, Font.systemFont(11), C.dim, { lines: 1 });
}

function drawRect(w, lang, e) {
  addText(w, `${e.word} · ${e.reading}`, Font.semiboldSystemFont(15), null, { lines: 1, scale: 0.6 });
  addText(w, e.def, Font.systemFont(13), null, { lines: 2, scale: 0.85 });
}

function drawInline(w, lang, e) {
  const short = e.def.split(";")[0];
  addText(w, `${e.word} ${e.reading} – ${short}`, Font.systemFont(12), null, { lines: 1 });
}

function drawCircular(w, lang, e) {
  w.addAccessoryWidgetBackground = true;
  addText(w, e.word, Font.boldSystemFont(22), null, { lines: 1, scale: 0.3, center: true });
}

function buildWidget(family, picks, date) {
  const w = new ListWidget();
  const accessory = String(family).startsWith("accessory");
  if (!accessory) {
    w.backgroundColor = C.bg;
    w.setPadding(14, 16, 14, 16);
  }
  const [lang, e] = picks[0];
  switch (family) {
    case "accessoryInline": drawInline(w, lang, e); break;
    case "accessoryCircular": drawCircular(w, lang, e); break;
    case "accessoryRectangular": drawRect(w, lang, e); break;
    case "medium": picks.length > 1 ? drawMediumBoth(w, picks) : drawMediumSingle(w, lang, e); break;
    case "large":
    case "extraLarge": drawLarge(w, picks, date); break;
    default: drawSmall(w, lang, e);
  }
  w.refreshAfterDate = nextMidnight(date);
  return w;
}

function errorWidget(family, message) {
  const w = new ListWidget();
  if (String(family).startsWith("accessory")) {
    addText(w, "Word of the Day: setup needed", Font.systemFont(12), null, { lines: 2, scale: 0.7 });
  } else {
    w.backgroundColor = C.bg;
    addText(w, "Word of the Day", Font.boldSystemFont(14), C.text, { lines: 1 });
    w.addSpacer(4);
    addText(w, message, Font.systemFont(12), C.dim, { lines: 5, scale: 0.7 });
  }
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

// ---------- main ----------

async function main(now = new Date()) {
  const family = config.widgetFamily || "medium";
  const langs = config.runsInWidget ? parseLangs(args.widgetParameter, family) : ["zh", "ko"];
  let widget, picks;
  try {
    picks = [];
    for (const lang of langs) picks.push([lang, pickWord(await loadList(lang), lang, now)]);
    widget = buildWidget(family, config.runsInWidget ? picks : picks.slice(0, 1), now);
  } catch (err) {
    widget = errorWidget(family, err.message);
    picks = null;
  }

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else if (!picks) {
    await widget.presentSmall();
  } else {
    // Run in the app (or tapped): show today's words, then optional previews.
    const a = new Alert();
    a.title = "Today's words";
    a.message = picks.map(([l, e]) => `${LANGS[l].name}  ${e.word}\n${e.reading}\n${e.def}\n(${e.level})`).join("\n\n");
    const lock = buildWidget("accessoryRectangular", picks.slice(0, 1), now);
    const previews = ["Preview small", "Preview medium (both)"];
    if (typeof lock.presentAccessoryRectangular === "function") previews.push("Preview lock screen");
    previews.forEach((t) => a.addAction(t));
    a.addCancelAction("Done");
    const choice = await a.presentSheet();
    if (choice === 0) await buildWidget("small", picks.slice(0, 1), now).presentSmall();
    if (choice === 1) await buildWidget("medium", picks, now).presentMedium();
    if (choice === 2) await lock.presentAccessoryRectangular();
  }
  Script.complete();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { localDayIndex, seededPermutation, pickWord, nextMidnight, parseLangs, buildWidget, main };
}
if (typeof WOTD_TEST === "undefined") await main();
