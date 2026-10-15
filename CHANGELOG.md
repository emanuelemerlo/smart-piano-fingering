# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-10-15

### Changed
- **New fingering algorithm** (hybrid musical + biomechanical). The music is analysed first;
  recognised patterns impose or suggest the standard fingering, the biomechanical model chooses
  among acceptable fingerings. Results differ from 1.1.0 on most passages (see
  `tests/COMPARISON.md`: 77/302 reference cases passed with 1.1.0, 302/302 with 2.0.0).
- Chords are planned as a unit inside the search; the post-processing step
  (`enforceChordConsistency`) is gone, so no transition of the result is left unevaluated.
- Each search window now includes the previous (already fingered) note.
- The thumb on a black key is no longer forbidden in thumb passages; it is a context-dependent cost.
- A chord is now followed by a look-ahead of three notes.

### Added
- Canonical scale fingerings: 12 major and 12 harmonic minor keys, both hands, both directions;
  natural and melodic minor (melodic: raised form ascending, natural form descending).
- Recognition, with confidence, of scales, chromatic and pentatonic runs, five-finger positions,
  arpeggios (triads, seventh chords, inversions), broken chords, repeated notes and leaps.
- Explicit models for thumb passages, repeated notes (finger alternation when fast) and leaps.
- Context-dependent black-key rules; melodic penalty for the 5th finger inside a line.
- Key signature and staccato are read when the MuseScore API provides them.
- Configurable, documented coefficients (`DEFAULT_PARAMS`, `options.params`).
- Conflicts that cannot be solved (existing fingering against a held finger, chord wider than the
  hand, held notes that must be released) are reported in the final message.
- Musical reference suite, invariant tests, ES5 syntax guard, comparison with 1.1.0.

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
