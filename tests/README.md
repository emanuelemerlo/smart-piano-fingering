# Tests

| File | What it does | Needs MuseScore |
|---|---|---|
| `run-tests.js` | Unit tests of the embedded core and adapter against a mock score | no |
| `qml-compat-check.js` | Static checks on the QML file and version consistency | no |
| `musescore-runtime.js` | Runs the real plugin inside MuseScore 4 on 20 scenarios (see below) | yes |
| `runtime-scenarios.js` | The scenarios and their assertions | - |
| `lib/` | Score builder/parser (`musicxml.js`), test scores (`fixtures.js`), MuseScore runner (`harness.js`) | - |
| `golden/` | Saved fingering for a few scores, to detect any change of the algorithm | - |
| `fixtures/smoke.musicxml` | Small hand-written score | - |

## How the runtime tests work

MuseScore 4 has no `--plugin` option. The tests use
`mscore -o out.musicxml --extension <uri> score` instead, on a **test copy** of the QML in which
the dialog type is removed and a hook sets the dialog controls (hands, size, keep, compact repeated notes, selection),
calls the plugin's own `applyFingering()` and stores the dialog's status message in the score.
Everything else is production code running in MuseScore's own QML engine. The exported MusicXML
is then parsed and checked.

Covered: both/one hand, same staff twice, Keep existing on/off (including custom text such as
`1-2`), chords, rests, ties, grace notes, tuplets, unison between voices, selection (middle, first
and last measure, one staff only, same result as the full run), cross-staff notes, percussion
staves, empty scores, running twice, rollback after a failure while writing (fault injection),
all six hand profiles and a custom hand (cm and child's hand from the dialog), determinism, a 1536-note score, and a repeated-note pedal under another
voice (one finger; "write the finger only when it changes" on and off).

Not covered: how the dialog looks and clicks on its buttons (progress bar, Stop), and undo
(plugins have no undo API; the rollback test covers the single-command guarantee instead).

## Running

    node tests/musescore-runtime.js --musescore "/Applications/MuseScore 4.app/Contents/MacOS/mscore"

On Linux prefix it with `xvfb-run -a`. Useful options: `--list`, `--only a,b`, `--verbose`,
`--timeout <s>`, `--write-fixtures <dir>` (dump the test scores as `.musicxml` to open them in
MuseScore). If MuseScore itself fails, the output is saved (path printed, or `SPF_RUNTIME_LOG`)
and a diagnosis tells a plugin-folder problem from a MuseScore crash.

## Golden files

`golden/*.json` hold the exact fingering the algorithm gives for a few scores. The algorithm is
meant to stay stable between releases, so any change shows up as a diff. When a change is
intended: `node tests/musescore-runtime.js --musescore <path> --update-golden`, review the
diff of `tests/golden/`, commit. `SPF_GOLDEN=warn` turns mismatches into warnings (for example
to check whether a platform computes a different result).

## How strong are these tests?

The suite was checked by injecting 15 defects into the plugin one at a time (tie merging, keep
existing, custom-text protection, selection range, selection context, percussion, cross-staff,
rollback, hand size, anchors, two algorithm constants, a wrong digit, a QML syntax error, same
staff twice); all 15 are detected. New checks should be validated the same way.
