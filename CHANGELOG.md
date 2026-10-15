# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.0] - 2026-10-15

### Added
- Option **Repeated notes: write the finger only when it changes** (on by default): a key struck
  again with the same finger is numbered only on its first stroke.
- MuseScore runtime scenario `repeated-pedal` (pedal under another voice, compact numbering on
  and off) and Node regression tests for the pedal and for compact writing.

### Fixed
- Repeated-note pedals (a key repeated in one voice while another voice holds or moves, e.g. the
  G pedal in Tchaikovsky's *Morning Prayer* op. 39 no. 1, bars 16-21) are played with one finger
  throughout. Before, the pedal was treated as a fast repetition and its strokes were split
  between single notes and chords, so the finger changed irregularly from bar to bar
  (5-4-3-4-4-5, 5-5-4-3-4-5, 5-5-5-5-5-5, 5-4-2-4-4-4). Fast repetitions in a single line still
  change fingers.
- Case count in the 2.0.0 entry below (305, not 302).

### Changed
- Documentation aligned with 2.0.1: version in the README status, the README file list and testing
  section now include the MuseScore runtime tests and the QML checks, and the release notes no
  longer say that testing was done only outside MuseScore.
- `tests/compare-legacy.js` labels the current algorithm with the version declared in the plugin
  instead of a fixed "2.0.0"; `tests/COMPARISON.md` regenerated (306 cases).
- Dialog height increased to fit the new option.
- `CONTRIBUTING.md` no longer says that the automated tests do not run MuseScore.
- User guide (`docs/README.txt`) updated to 2.1.0; new release notes `docs/RELEASE-NOTES-2.1.0.md`.

## [2.0.1] - 2026-10-15

### Fixed
- An existing fingering that contradicts a recognised pattern (for example 5 on E in a C major
  scale) now makes the surrounding notes follow it; before, the notes around it kept the scale
  fingering as if the existing fingering were not there.
- Broken-chord accompaniments that change harmony every bar (C-E-G-E | G-B-D-B ...) are fingered
  5-3-1-3 in every bar: a note below the figure's bass starts a new figure, figures no longer
  share notes, and the hand may take the new position at the change of harmony.
- Successive fingers whose spacing does not match the keys (e.g. 1-4 on a second) now have a
  comfort cost, so such needlessly cramped fingerings are avoided.

### Changed
- Updated the golden files of the MuseScore runtime tests to the 2.0 algorithm (reviewed).

## [2.0.0] - 2026-10-15

### Changed
- **New fingering algorithm** (hybrid musical + biomechanical). The music is analysed first;
  recognised patterns impose or suggest the standard fingering, the biomechanical model chooses
  among acceptable fingerings. Results differ from 1.1.0 on most passages (see
  `tests/COMPARISON.md`: 77/305 reference cases passed with 1.1.0, 305/305 with 2.0.0).
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
