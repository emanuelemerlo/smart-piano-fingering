# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Cross-platform CI (`.github/workflows/multiplatform.yml`): algorithm tests, static QML checks and a runtime test that runs the real plugin inside MuseScore 4 on Linux, Windows and macOS.
- `tests/musescore-runtime.js`, `tests/qml-compat-check.js` and a MusicXML fixture.

### Changed
- CI actions updated to Node 24-based versions; Node 22 for the test scripts.

## [1.1.0] - 2026-10-13

### Fixed
- **Unisons between voices** (same pitch and onset, e.g. voice 1 and voice 2): the fingering was written on every note of the group. It is now written once, on the lowest voice. The choice is deterministic and no longer depends on sort stability.
- An error while writing could leave the score command open. The command is now rolled back on failure.
- Invalid disabled-state colour for the "Selection only" checkbox (`activePalette.text.disabled` does not exist).
- MuseScore version check (`major >= 4 && minor >= 4`) would fail on a future 5.x; it is now `major > 4 || (major == 4 && minor >= 4)`.
- "Selection only" availability was computed once at start-up although the dialog is non-modal; it now follows the selection and is re-read when Apply is pressed.
- Cross-staff notes were attributed to the staff that stores them instead of the one that displays them, giving them the wrong hand.
- Tuplet durations are now validated against the distance to the next element of the voice instead of assuming how `duration` is scaled.

### Changed
- The calculation runs in short slices driven by a `Timer`: the dialog stays responsive, shows a progress bar and can be stopped. Nothing is written until the calculation completes.
- "Selection only" now processes only the selected staves and time range plus 12 beats of context on each side, instead of the whole staff.
- Replace mode (Keep existing off) now replaces only plain finger numbers `1`–`5`. Notes carrying other fingering text (e.g. `1-2`) are left untouched and counted in the status message.
- The fingering algorithm itself is unchanged: results are identical to 1.0.0.
- The reading adapter reads the target staves in a single pass and records the voice of every note.
- Dialog height increased to fit the progress bar; added a **Stop** button.

### Added
- Percussion staves are rejected with a message.
- Automated Node tests (`tests/run-tests.js`) and a CI workflow running them.
- `THIRD_PARTY_NOTICES.md`; attribution in the file header and in `AUTHORS.md`.

## [1.0.0] - 2026-10-12

### Added
- Initial public release: right/left hand fingering, hand-size presets, keep/replace existing fingerings, selection filter, tied notes, all four voices, undoable operation.
