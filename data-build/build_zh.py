"""Build dist/word-of-the-day/zh.json: HSK 3.0 levels 1-3, simplified Chinese.

Source: drkameleon/complete-hsk-vocabulary (MIT); English meanings in it come
from CC-CEDICT (CC BY-SA 4.0).

Run from anywhere:  python3 -I data-build/build_zh.py
"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-build" / "raw" / "complete.min.json"
OUT = ROOT / "dist" / "word-of-the-day" / "zh.json"
URL = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json"
MAX_LEVEL = 3
MAX_DEF = 60

# Senses that are unhelpful on a widget (cross-references, surnames, classifiers).
SKIP_SENSE = re.compile(
    r"^(old |archaic |erhua |japanese |taiwan pr\.|also pr\.|colloquial pr\.|abbr\. for|see |surname |"
    r"\(?(old )?variant of |used in |cl:|classifier for |\(bound form\)$)",
    re.I,
)
VOWEL_START = re.compile(r"^[aeoāáǎàēéěèōóǒò]", re.I)


def download():
    if not RAW.exists():
        RAW.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(URL, RAW)


def join_pinyin(spaced):
    """'ā yí' -> 'āyí'; 'xī ān' -> "xī'ān" (pinyin apostrophe rule)."""
    out = ""
    for syl in re.sub(r"r5\b", "r", spaced).split():  # erhua: "yǒukòngr5" -> "yǒukòngr"
        if out and VOWEL_START.match(syl):
            out += "'"
        out += syl
    return out


def clean_senses(meanings):
    senses = []
    for m in meanings:
        m = re.sub(r"\s+", " ", m).strip()
        m = re.sub(r"\s*\(CL:[^)]*\)", "", m)  # drop classifier notes
        m = re.sub(r"\s*\((?:[\w ]+ )?pr\. \[[^\]]*\][^)]*\)", "", m)  # '(colloquial pr. [nèi])'
        m = re.sub(r"\[[a-zA-Z0-9: ]+\]", "", m).strip()  # '您[nin2]' -> '您'
        if m and not SKIP_SENSE.match(m) and m not in senses:
            senses.append(m)
    return senses


def short_def(senses):
    """Up to 3 senses, cut at a sense boundary to fit MAX_DEF chars."""
    out = senses[0]
    if len(out) > MAX_DEF:
        return out[: MAX_DEF - 1].rstrip(" ,;") + "…"
    for s in senses[1:3]:
        if len(out) + 2 + len(s) > MAX_DEF:
            break
        out += "; " + s
    return out


# No open HSK list says which reading of a multi-reading word is meant, and the
# heuristic in pick_form misses some. Hand-checked choices (dataset spacing):
READING_OVERRIDES = {
    "啊": "a", "场": "chǎng", "称": "chēng", "得": "de", "干": "gàn", "告诉": "gào su",
    "化": "huà", "教": "jiāo", "句": "jù", "空": "kōng", "了": "le", "吗": "ma",
    "没": "méi", "那": "nà", "胖": "pàng", "骑": "qí", "起来": "qǐ lai", "强": "qiáng",
    "所长": "suǒ zhǎng", "为": "wèi", "雨": "yǔ", "长": "cháng", "着": "zhe", "重": "zhòng",
}
# Cross-references whose target isn't in the HSK dataset (senses from CC-CEDICT).
DEF_OVERRIDES = {
    "干吗": "why?; what for?; what are you doing?",
    "老头儿": "old man; old fellow",
    "干": "to do; to work; to manage",  # first CEDICT sense of 幹 is 'tree trunk'
}

CROSS_REF = re.compile(r"^(?:see|(?:old |unofficial )?variant of)\s+([一-鿿]+)")


def resolve_meanings(meanings, by_word, self_word, depth=0):
    """Replace 'see 干嘛' / 'variant of 记录' with the target word's meanings.
    Self-references (了 liào: 'variant of 了') are dropped, not expanded."""
    out = []
    for m in meanings:
        ref = CROSS_REF.match(m.strip())
        if ref and ref.group(1) == self_word:
            continue
        if ref and depth < 2 and ref.group(1) in by_word:
            for f in by_word[ref.group(1)]["f"]:
                out += resolve_meanings(f["m"], by_word, self_word, depth + 1)
        else:
            out.append(m)
    return out


def pick_form(word, forms, by_word):
    """Best pronunciation for a multi-reading word. The data doesn't say which
    reading HSK means, so: READING_OVERRIDES first, then common (lowercase)
    readings before proper nouns like 'Mǎn', then the reading with the most senses
    (行 -> xíng, not háng; 都 -> dōu). Classifier-only words (辆 'classifier for
    vehicles') keep that sense as a last resort."""
    want = READING_OVERRIDES.get(word)
    candidates = []
    for i, f in enumerate(forms):
        meanings = resolve_meanings(f["m"], by_word, word)
        senses = clean_senses(meanings)
        proper = f["i"]["y"][:1].isupper()
        override = f["i"]["y"] == want
        candidates.append((override, bool(senses), not proper, len(senses), -i, f, senses, meanings))
    if want and not any(c[0] for c in candidates):
        raise SystemExit(f"READING_OVERRIDES[{word!r}] = {want!r} matches no reading")
    if not candidates:
        return None, []
    _, has, _, _, _, f, senses, meanings = max(candidates, key=lambda c: c[:5])
    if has:
        return f, senses
    fallback = [re.sub(r"\s+", " ", m).strip() for m in meanings if m.strip()]
    return (f, fallback) if fallback else (None, [])


def main():
    download()
    data = json.loads(RAW.read_text(encoding="utf-8"))
    by_word = {e["s"]: e for e in data}
    words, dropped = [], []
    for e in data:
        levels = [int(l[1:]) for l in e["l"] if l.startswith("n") and l[1:].isdigit()]
        if not levels or min(levels) > MAX_LEVEL:
            continue
        form, senses = pick_form(e["s"], e["f"], by_word)
        if not form:
            dropped.append(e["s"])
            continue
        words.append({
            "word": e["s"],
            "reading": join_pinyin(form["i"]["y"]),
            "def": DEF_OVERRIDES.get(e["s"]) or short_def(senses),
            "level": f"HSK {min(levels)}",
        })

    seen, unique = set(), []
    for w in words:
        if w["word"] not in seen:
            seen.add(w["word"])
            unique.append(w)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(unique, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(unique)} words to {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    if dropped:
        print(f"dropped {len(dropped)} with no usable meaning: {' '.join(dropped[:20])}")


if __name__ == "__main__":
    main()
