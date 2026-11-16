# Word of the Day widget (Chinese + Korean)

A free iPhone home-screen and lock-screen widget that shows one Chinese or Korean
word per day (word, pinyin / romanization, English definition). It runs in the free
[Scriptable](https://scriptable.app) app: no App Store publishing, no Xcode, no 7-day
expiry, and no backend. The word lists ship as JSON files, and the day's word is
picked from the date.

| Language | Words | Level | Reading |
|---|---|---|---|
| Chinese (`zh`) | 2,209 | HSK 3.0 levels 1–3, simplified | tone-marked pinyin |
| Korean (`ko`) | 891 | NIKL grade A (beginner, ≈ TOPIK I) | Revised Romanization (by pronunciation: 같이 → *gachi*) |

## Install on your iPhone

1. Install **Scriptable** from the App Store and open it once. Make sure iCloud Drive
   is on (Settings → your name → iCloud → iCloud Drive).
2. **Copy** (not move) the contents of `dist/` into the **Scriptable** folder in iCloud Drive.
   In Finder, dragging to iCloud Drive *moves* files. Hold ⌥ Option while dragging to copy.
   - From a Mac signed in to the same iCloud account: copy into
     `~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/`, or
   - AirDrop / Files app: put `Word of the Day.js` and the `word-of-the-day/` folder
     in *iCloud Drive → Scriptable*.

   You should end up with:
   ```
   Scriptable/
     Word of the Day.js
     word-of-the-day/zh.json
     word-of-the-day/ko.json
   ```
3. Open Scriptable and tap **Word of the Day** once to check that it runs. You'll see a preview.

### Home screen
Long-press the home screen → **+** → Scriptable → choose a size → **Add Widget**.
Then long-press the widget → **Edit Widget**:
- **Script**: Word of the Day
- **Parameter**: `zh` for Chinese, `ko` for Korean, or `both` (medium/large only)

Add one widget per language, or stack them in a Smart Stack and swipe between them.

### Lock screen
Long-press the lock screen → **Customize** → Lock Screen → tap the widget area →
Scriptable. Tap the added widget to set the same Script and Parameter.
The rectangular slot shows word, reading and definition. The inline slot above the clock fits one line.

## How it works
- The day's word is a deterministic shuffle of the list, indexed by the number of
  days since 2026-01-01 in your **local** time zone. Every word appears once before any repeats.
- The widget asks iOS to refresh at local midnight. iOS may refresh a few minutes late.
- **Tapping** opens today's word in a dictionary: [MDBG](https://www.mdbg.net) for Chinese,
  [Naver Korean–English](https://korean.dict.naver.com/koendict/) for Korean. In a `both`
  widget, each half opens its own word. This overrides the widget's "When Interacting" setting.
  To see the "Today's words" sheet and widget previews, run the script inside Scriptable.

## Rebuilding the word lists
```bash
python3 -I data-build/build_zh.py
python3 -m venv data-build/.venv && data-build/.venv/bin/pip install -r data-build/requirements.txt
data-build/.venv/bin/python -I data-build/build_ko.py
```
Source files download into `data-build/raw/` (git-ignored; the Korean Wiktionary
extract is ~200 MB). Each build prints the words it had to guess or skip, so you can check them.

## Tests
```bash
node test/harness.mjs
```
Stubs the Scriptable API and runs the widget script for every widget size and language,
checking that the day's word is stable within a day, changes at local midnight, and
doesn't repeat within a cycle. It also validates both data files.

## Data sources & licenses
- **Chinese**: [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary)
  (MIT). Its English meanings come from [CC-CEDICT](https://cc-cedict.org/wiki/)
  (CC BY-SA 4.0). For words with several readings, the build picks the everyday one,
  using a heuristic plus hand-checked overrides in `build_zh.py`.
- **Korean**: word list and grades from the National Institute of Korean Language
  (국립국어원), *한국어 학습용 어휘 목록* (2003). Definitions and romanization come from English
  [Wiktionary](https://en.wiktionary.org) via [kaikki.org](https://kaikki.org)
  (CC BY-SA 4.0). Four words Wiktionary doesn't romanize (서울, 부산, 라디오, 한자) use
  [korean-romanizer](https://github.com/osori/korean-romanizer) as a fallback at build time.

The generated `dist/word-of-the-day/*.json` files are derived from CC BY-SA
data, so they are shared under CC BY-SA 4.0.
