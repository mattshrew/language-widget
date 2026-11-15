"""Build dist/word-of-the-day/ko.json: beginner Korean (NIKL grade A, ~980 words).

Sources:
  - Word list + grades: National Institute of Korean Language (국립국어원),
    "한국어 학습용 어휘 목록" (2003). Grade A = beginner tier.
  - Definitions + Revised Romanization: English Wiktionary via kaikki.org
    (CC BY-SA 4.0 / GFDL). Wiktionary romanizes by pronunciation (학교 -> hakgyo).

Setup:  python3 -m venv data-build/.venv && data-build/.venv/bin/pip install -r data-build/requirements.txt
Run:         data-build/.venv/bin/python -I data-build/build_ko.py
"""
import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-build" / "raw"
XLS = RAW / "nikl-vocab.xls"
KAIKKI = RAW / "kaikki-korean.jsonl"
OUT = ROOT / "dist" / "word-of-the-day" / "ko.json"
XLS_URL = (
    "https://www.korean.go.kr/common/download.do?file_path=etcData"
    "&c_file_name=5a4a2f5c-66c9-425d-88fb-854289ea2521_0.xls"
    "&o_file_name=%ED%95%9C%EA%B5%AD%EC%96%B4%20%ED%95%99%EC%8A%B5%EC%9A%A9%20%EC%96%B4%ED%9C%98%20%EB%AA%A9%EB%A1%9D.xls"
)
KAIKKI_URL = "https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl"
GRADE = "A"
MAX_DEF = 60

# NIKL part-of-speech codes -> Wiktionary POS names, in preference order.
POS = {
    "명": ["noun"], "의": ["noun"], "고": ["name", "noun"], "대": ["pron", "noun"],
    "동": ["verb"], "보": ["verb", "adj"], "형": ["adj", "verb"], "부": ["adv"],
    "수": ["num", "noun"], "관": ["det", "adj", "num"], "감": ["intj"], "불": [],
}
SKIP_SENSE = re.compile(r"^(obsolete|archaic|misspelling of|eye dialect)", re.I)
# "contraction of 이야기 (iyagi): talk; story", "alternative form of 어떻다 (eotteota, “to be how”)",
# "formal form of 이렇다 (ireota)" -> take the meaning from the gloss or from the target word.
REF_SENSE = re.compile(
    r"^(?:(?:alternative|formal|informal|honorific|polite|plain|short|contracted|colloquial) form"
    r"|contraction|abbreviation|clipping|short|synonym)\s+(?:of|for)\s+([가-힣]+)(.*)$", re.I)
HARD_SKIP_TAGS = {"obsolete", "archaic", "Middle-Korean", "vulgar", "slang", "euphemistic"}
SOFT_SKIP_TAGS = {"rare", "dialectal", "North-Korea", "literary"}  # used only if nothing else
HANJA = re.compile(r"[一-鿿]")


def download():
    RAW.mkdir(parents=True, exist_ok=True)
    for path, url in ((XLS, XLS_URL), (KAIKKI, KAIKKI_URL)):
        if not path.exists():
            print(f"downloading {path.name} ...")
            urllib.request.urlretrieve(url, path)


def load_nikl():
    sheet = xlrd.open_workbook(str(XLS)).sheet_by_index(0)
    rows = []
    for r in range(1, sheet.nrows):
        rank, word, pos, hanja, grade = sheet.row_values(r)
        if grade != GRADE:
            continue
        rows.append({
            "word": re.sub(r"\d+$", "", str(word)).strip(),  # '가구03' -> '가구'
            "pos": pos.strip(),
            "hanja": "".join(HANJA.findall(str(hanja))),
            "rank": rank if isinstance(rank, float) else 1e9,
        })
    return rows


def load_kaikki(wanted):
    """Index Wiktionary entries by word, only for the words we need."""
    index = defaultdict(list)
    with KAIKKI.open(encoding="utf-8") as f:
        for line in f:
            # cheap prefilter before json parsing (the file is ~200 MB)
            m = re.match(r'\{"word": "([^"]+)"', line)
            if m and m.group(1) not in wanted:
                continue
            e = json.loads(line)
            if e.get("word") in wanted and e.get("lang_code") == "ko":
                index[e["word"]].append(e)
    return index


def entry_hanja(e):
    found = "".join(f["form"] for f in e.get("forms", []) if "hanja" in f.get("tags", []))
    return found + e.get("etymology_text", "")


def romanization(e):
    for f in e.get("forms", []):
        if "romanization" in f.get("tags", []):
            return f["form"]
    for s in e.get("sounds", []):
        if s.get("roman"):
            return s["roman"]
    return None


def ref_target(gloss):
    m = REF_SENSE.match(gloss.strip())
    return m.group(1) if m else None


def expand_gloss(g, index, depth):
    """Turn a cross-reference gloss into real meanings; plain glosses pass through."""
    m = REF_SENSE.match(g)
    if not m:
        return [g]
    target, tail = m.groups()
    if ":" in tail:  # '(iyagi): talk; story'
        return [tail.split(":", 1)[1].strip()]
    quoted = re.search(r"“([^”]+)”", tail)  # '(eotteota, “to be how”)'
    if quoted:
        return [quoted.group(1)]
    if depth < 2 and target in index:
        return [s for e in index[target] for s in senses(e, index, depth + 1)][:3]
    return []


def senses(e, index, depth=0):
    """Definitions in order, preferring senses without SOFT_SKIP_TAGS."""
    preferred, fallback = [], []
    for s in e.get("senses", []):
        tags = set(s.get("tags", []))
        if HARD_SKIP_TAGS & tags:
            continue
        bucket = fallback if SOFT_SKIP_TAGS & tags else preferred
        for g in s.get("glosses", [])[-1:]:  # last gloss is the most specific
            g = re.sub(r"\s+", " ", g).strip()
            if not re.search(r"\b\w\.\w\.$", g):  # keep "a.m."
                g = g.rstrip(".")
            if not g or SKIP_SENSE.match(g):
                continue
            for x in expand_gloss(g, index, depth):
                if x and x not in preferred and x not in fallback:
                    bucket.append(x)
    return preferred or fallback


def best_entry(row, entries, index):
    """Prefer: matching hanja, matching part of speech, has senses, has romanization."""
    pos_pref = POS.get(row["pos"], [])

    def score(e):
        hanja_match = bool(row["hanja"]) and row["hanja"] in entry_hanja(e)
        pos_rank = pos_pref.index(e["pos"]) if e.get("pos") in pos_pref else len(pos_pref)
        return (hanja_match, -pos_rank, romanization(e) is not None)

    usable = [e for e in entries if senses(e, index)]
    return max(usable, key=score) if usable else None


def short_def(ss):
    """Up to 2 senses (later Wiktionary senses get obscure fast), cut at a sense
    boundary to fit MAX_DEF. Long parenthetical notes are dropped if needed."""
    ss = [s if len(s) <= MAX_DEF else re.sub(r"\s*\([^)]*\)", "", s) for s in ss]
    uniq = []
    for s in ss:
        if s.lower() not in (u.lower() for u in uniq):
            uniq.append(s)
    out = uniq[0]
    if len(out) > MAX_DEF:
        # cut at the last comma, else the last word, that fits
        cut = out[: MAX_DEF - 1]
        cut = cut[: cut.rfind(",")] if "," in cut[20:] else cut[: cut.rfind(" ")]
        return cut.rstrip(" ,;") + "…"
    for s in uniq[1:2]:
        if len(out) + 2 + len(s) > MAX_DEF:
            break
        out += "; " + s
    return out


def fallback_romanization(word):
    """For the few words Wiktionary doesn't romanize (mostly loanwords and place
    names). korean-romanizer misses some sound changes, so the build reports these."""
    from korean_romanizer.romanizer import Romanizer
    return Romanizer(word).romanize()


def main():
    download()
    rows = load_nikl()
    wanted = {r["word"] for r in rows}
    index = load_kaikki(wanted)
    # second pass: words that cross-references point to ('contraction of 무어')
    targets = {t for es in index.values() for e in es for s in e.get("senses", [])
               for g in s.get("glosses", [])[-1:] if (t := ref_target(g))} - wanted
    index.update(load_kaikki(targets))
    words, missing, no_roman = [], [], []
    seen = set()
    for row in sorted(rows, key=lambda r: r["rank"]):
        e = best_entry(row, index.get(row["word"], []), index)
        if not e:
            missing.append(row["word"])
            continue
        if row["word"] in seen:  # NIKL lists some words once per homonym; show each word once
            continue
        seen.add(row["word"])
        roman = romanization(e)
        if not roman:
            roman = fallback_romanization(row["word"])
            no_roman.append(f"{row['word']}={roman}")
        words.append({
            "word": row["word"],
            "reading": roman,
            "def": short_def(senses(e, index)),
            "level": "TOPIK I",
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(words, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(words)} words to {OUT} ({OUT.stat().st_size // 1024} KB)")
    print(f"no Wiktionary entry ({len(missing)}): {' '.join(missing)}")
    print(f"romanized by korean-romanizer, check these ({len(no_roman)}): {' '.join(no_roman)}")


if __name__ == "__main__":
    main()
