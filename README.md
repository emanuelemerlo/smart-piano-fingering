# Smart Piano Fingering

MuseScore plugin that calculates and inserts piano fingering numbers (`1`–`5`) for the right and left hands.

> **Status:** version 2.0.0. The fingering algorithm and the score-reading logic are covered by automated tests that run outside MuseScore (see [Testing](#testing)). The plugin as a whole has **not** been validated on every MuseScore release: try it on a copy of your score first.

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

## How the algorithm works (version 2)

Version 2 is a hybrid: it first recognises the music, then applies established piano technique,
and only then lets the biomechanical model choose among the musically acceptable fingerings.

1. **Musical analysis** (once per staff). Lines of single notes and chords are scanned for
   major and minor scales (harmonic, melodic, natural) in all keys, chromatic runs, pentatonic
   runs, five-finger positions, arpeggios (triads, sevenths, inversions), broken chords (Alberti
   bass...), repeated notes and leaps. Each pattern gets a **confidence**: high confidence makes
   the canonical fingering a constraint, medium confidence a preference, low confidence is ignored.
   The key signature, when MuseScore provides it, helps to choose between keys.
2. **Canonical fingerings**: an internal database of the standard scale fingerings (12 major and
   12 harmonic minor keys, both hands, both directions; natural and melodic minor derived from
   them), the standard chromatic fingering, rules for arpeggios and chord shapes.
3. **Context-dependent rules**: thumb and fifth finger on black keys are penalised in scales and
   lines but accepted in chords and black-key arpeggios; thumb passages are modelled explicitly;
   fast repeated notes change finger; leaps reposition the hand.
4. **Search**: the original DP / branch-and-bound search over a window of notes, now including the
   previous note so that every transition is evaluated, with chords planned as a unit.
   Hard constraints (held notes, chord order and span, your existing fingerings) are relaxed only
   when nothing else works, and any remaining conflict is reported in the final message.

The rules, their musical rationale and every coefficient are documented in the code
(`createSmartPianoFingeringCore`); coefficients are collected in `DEFAULT_PARAMS`.

## Behaviour notes

- Slurs, dynamics and accents are not read (the plugin API offers no reliable access to them);
  staccato is used when MuseScore exposes it. The tempo is not read: "fast" and "slow" are
  judged in beats.
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
| `tests/run-tests.js` | Node tests: algorithm, musical reference suite, invariants, score adapter (mock score). |
| `tests/musical-suite.js` | Reference cases (scales, chromatic, arpeggios, chords, repeated notes, black keys, leaps, held notes, combinations). |
| `tests/compare-legacy.js` | Compares version 1.1.0 (`tests/legacy/`) with the current algorithm. |
| `tests/REPORT.md`, `tests/COMPARISON.md` | Generated test tables. |
| `CHANGELOG.md` | Release history. |
| `LICENSE` | GNU General Public License v3.0. |
| `THIRD_PARTY_NOTICES.md` | Attribution for the algorithm's origin. |
| `AUTHORS.md` | Authors and attribution. |
| `CONTRIBUTING.md` | Contribution and validation guidance. |
| `SECURITY.md` | Responsible reporting guidance. |
| `.github/` | Issue/PR templates and the repository checks workflow. |

## Testing

```bash
node tests/run-tests.js            # all tests
node tests/run-tests.js --report   # also writes tests/REPORT.md
node tests/compare-legacy.js       # writes tests/COMPARISON.md (1.1.0 vs current)
```

The tests extract the embedded JavaScript from the QML file and run it against a mock score. They verify the algorithm against a reference suite of standard fingerings (classified as canonical, acceptable variant, non-standard or physically impossible by an independent checker), structural invariants on random material, and the adapter logic (unisons, ties, tuplets, cross-staff, selection window, keep/replace rules). They do **not** exercise MuseScore's QML runtime, so manual verification is still required before a release; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GNU General Public License v3.0 only (`GPL-3.0-only`). See [`LICENSE`](LICENSE).

Copyright (C) 2026 Emanuele Merlo. The fingering algorithm was originally derived from PianoPlayer by Marco Musy (MIT License) and has been substantially modified and extended; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
