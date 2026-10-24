# Contributing

Thank you for helping improve Smart Piano Fingering.

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By taking part you agree to respect it.

To report a fingering that looks unnatural, open an issue with the **Unnatural fingering** template: it asks for the passage, the hand, the hand profile and the fingering you would expect.

## Ground rules

- The plugin is a single QML file with an embedded JavaScript core (`createSmartPianoFingeringCore`) and a MuseScore adapter (`createMuseScoreAdapter`). Keep them free of UI dependencies so they stay testable in Node.
- Keep `thumbnailName` in sync with the PNG file name.
- When you change user-visible behaviour, add an entry under `[Unreleased]` in `CHANGELOG.md`.
- Changes to the fingering algorithm must state their musical rationale and show before/after examples; the algorithm is intentionally stable between releases.

## Development workflow

1. Edit `smart-piano-fingering.qml`.
2. Run the automated tests: `node tests/run-tests.js` (add `--report` to regenerate `tests/REPORT.md`).
   For algorithm changes also run `node tests/compare-legacy.js` and look at every changed case.
   Add reference cases to `tests/musical-suite.js` with their source (method book, rule, ...);
   do not write expected fingerings by copying the plugin's output.
3. Copy the files to your MuseScore plugins folder and test on a **disposable score**.

## Translations

The dialog strings are translated in `translationTable()` in `smart-piano-fingering.qml`, one table per language, keyed by the English text. In the dialog code, wrap every user-visible string in `tr("...")` and use `%1`, `%2` with `.arg()` instead of concatenating pieces of a sentence (word order and grammar differ between languages).

- **New or changed string**: add it to every table (if you cannot translate it, use the English text and say so in the PR so a native speaker can fix it).
- **New language**: copy a table, translate the values, add a `case "xx":` with the language code as MuseScore uses it (`fr`, `zh_CN`, ...). Regional variants (`fr_CA`, `pt_BR`) automatically use the language table.
- **Corrections from native speakers** are very welcome.

`node tests/qml-compat-check.js` fails if a table misses a string, contains a string the dialog no longer uses, or changes the placeholders.

## Manual verification before a release

The CI runs the plugin inside MuseScore 4 on Windows, macOS and Linux (`tests/musescore-runtime.js`), but it does not cover the dialog itself (layout, buttons, progress bar, Stop) or Undo. Before tagging a release verify by hand, and record the MuseScore version and OS used:

- The plugin appears in the Plugins menu and opens without QML errors; the dialog shows the right version.
- With MuseScore set to another language (for example Italian or Japanese; restart MuseScore after changing it) the dialog is translated and still fits.
- Right hand only, left hand only, both hands; single-staff and multi-staff scores.
- Keep existing fingerings on and off, including a custom text such as `1-2`.
- Selection only: a selection covering one staff and one covering both.
- Chords, rests, multiple voices, **unisons between voices**, tied notes, tuplets, cross-staff notes.
- A long score: dialog stays responsive, progress advances, **Stop** writes nothing.
- Undo reverts the whole operation in one step.

Do not list a MuseScore version as supported until it has been tested.

## Pull requests

Describe what changed and why, how you tested it, and tick the checklist in the PR template. Keep PRs focused.

## License

By contributing you agree that your contribution is licensed under GPL-3.0-only, the license of this project.
