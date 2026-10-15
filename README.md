# Smart Piano Fingering

MuseScore plugin that calculates and inserts piano fingering numbers (`1`–`5`) for the right and left hands.

> **Status:** version 1.1.0. The fingering algorithm and the score-reading logic are covered by automated tests, which also run the plugin inside MuseScore 4 on Linux, Windows and macOS (see [Testing](#testing)). The plugin as a whole has **not** been validated on every MuseScore release: try it on a copy of your score first.

## Features

- Right-hand and left-hand fingering, on any two staves you choose.
- Hand-size presets: `XXS`, `XS`, `S`, `M`, `L`, `XL`, `XXL`.
- Keeps your existing fingerings (and uses them as anchors for the calculation) or replaces them.
- **Selection only** mode: processes just the selected region and staves, plus a few bars of musical context.
- Reads all four voices of a staff, merges tied notes, handles tuplets.
- **Unisons between voices** (same pitch, same onset, e.g. voice 1 and voice 2 on the same note) get a **single** fingering, written on the lowest voice.
- **Cross-staff notes** are assigned to the staff where they are displayed, so they receive the correct hand.
- Responsive dialog: progress bar and a **Stop** button; nothing is written to the score until the calculation is complete.
- One undo step (`Ctrl+Z` / `Cmd+Z`) reverts the whole operation.

## Requirements

- MuseScore with QML plugin support (written against the MuseScore 4 plugin API; the `MuseScore 3.0` import is kept for compatibility, and MuseScore 3 may work but is untested).
- A score must be open.
- Qt Quick Controls and Layouts, as shipped with MuseScore.

## Installation

1. Download `smart-piano-fingering.qml` and `smart-piano-fingering.png` (or the repository ZIP / a release).
2. Copy both files into your MuseScore plugins folder, for example:
   - MuseScore 4: `Documents/MuseScore4/Plugins/`
   - MuseScore 3: `Documents/MuseScore3/Plugins/`

   The exact location depends on your OS and settings (check *Preferences → General → Folders*).
3. In MuseScore open **Plugins → Manage plugins** (MuseScore 4: *Home → Plugins*), enable **Smart Piano Fingering**, and restart MuseScore if it does not appear.
4. Open a score and run the plugin from the Plugins menu.

Keep the QML file and the PNG together. If the plugin is not listed, check the plugin folder and the MuseScore log for QML errors.

## Usage

1. Open the score and launch the plugin.
2. Set the staff number for the **right hand** and, optionally, the **left hand** (`0` = none).
3. Choose a **hand size**. Presets are heuristic, not a measured hand model.
4. **Keep existing fingerings**:
   - *on* – existing fingerings are never touched; plain numbers `1`–`5` are used as anchors by the calculation.
   - *off* – plain numbers `1`–`5` are replaced. Notes carrying any other fingering text (for example a substitution such as `1-2`) are left untouched and reported in the final message.
5. **Selection only** – enabled when a range selection exists. Only the selected staves and time range are written; a few bars around the selection are read to give the algorithm context.
6. Press **Apply**. Review the result musically; undo with `Ctrl+Z` if needed.

Do not edit the score while the calculation is running (it usually takes a few seconds). Press **Stop** to abort; nothing is written in that case.

## Behaviour notes

- The output is a *suggestion*. It cannot replace a pianist's judgement, and some passages need manual correction.
- Fingerings are chosen per staff/hand. Notes of all voices on the staff are treated as played by that hand.
- Grace notes are not fingered. Percussion staves are rejected.
- The dialog uses the system colour palette, which may differ from MuseScore's own light/dark theme.
- Always work on a copy or save the score before bulk changes.

## Files

| File | Purpose |
|---|---|
| `smart-piano-fingering.qml` | Plugin UI, fingering algorithm and MuseScore adapter. |
| `smart-piano-fingering.png` | Plugin thumbnail referenced by `thumbnailName`. |
| `tests/run-tests.js` | Node tests for the algorithm and the score adapter (mock score). |
| `tests/qml-compat-check.js` | Static checks on the QML file and on version consistency. |
| `tests/musescore-runtime.js` | Runs the real plugin inside MuseScore 4 (headless) on 19 scenarios and checks the exported scores. |
| `tests/runtime-scenarios.js`, `tests/lib/`, `tests/golden/`, `tests/fixtures/` | Scenarios, helpers, saved fingering results and a sample score for the runtime tests. |
| `CHANGELOG.md` | Release history. |
| `LICENSE` | GNU General Public License v3.0. |
| `THIRD_PARTY_NOTICES.md` | Attribution for the algorithm's origin. |
| `AUTHORS.md` | Authors and attribution. |
| `CONTRIBUTING.md` | Contribution and validation guidance. |
| `SECURITY.md` | Responsible reporting guidance. |
| `.github/` | Issue/PR templates, the repository checks workflow and the cross-platform test workflow. |

## Testing

```bash
node tests/run-tests.js          # algorithm + adapter, mock score (no MuseScore needed)
node tests/qml-compat-check.js   # static checks on the QML file and version consistency
node tests/musescore-runtime.js --musescore "<path to the MuseScore executable>"
```

`run-tests.js` extracts the embedded JavaScript from the QML file and runs it against a mock score: algorithm and adapter logic (unisons, ties, tuplets, cross-staff, selection window, keep/replace rules).

`musescore-runtime.js` loads the plugin in a real MuseScore 4 (headless, via `--extension`) and runs 19 scenarios on small scores (one or both hands, Keep existing on/off, chords, ties, tuplets, unisons, selection, cross-staff, percussion, rollback after a failure, all hand sizes, a 1536-note score) and checks the exported MusicXML. Golden files in `tests/golden/` pin the exact fingering, so any change of the algorithm shows up as a diff. The GitHub Actions workflow runs it on Linux, Windows and macOS. It does **not** exercise the dialog (layout and button clicks), so manual verification is still required before a release; see [CONTRIBUTING.md](CONTRIBUTING.md) and [`tests/README.md`](tests/README.md).

## License

GNU General Public License v3.0 only (`GPL-3.0-only`). See [`LICENSE`](LICENSE).

Copyright (C) 2026 Emanuele Merlo. The fingering algorithm was originally derived from PianoPlayer by Marco Musy (MIT License) and has been substantially modified and extended; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
