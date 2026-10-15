# Contributing

Thank you for helping improve Smart Piano Fingering.

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

## Manual verification before a release

Automated tests do not run MuseScore's QML runtime. Before tagging a release verify, and record the MuseScore version and OS used:

- The plugin appears in the Plugins menu and opens without QML errors.
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
