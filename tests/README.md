# Tests

| File | What it does | Needs MuseScore |
|---|---|---|
| `run-tests.js` | Unit tests of the embedded core and adapter against a mock score | no |
| `qml-compat-check.js` | Static checks on the QML file and version consistency | no |
| `musescore-runtime.js` | Runs the real plugin inside MuseScore 4 and checks the exported fingerings | yes |

MuseScore 4 has no `--plugin` option. The runtime test uses
`mscore -o out.musicxml --extension <uri> score` instead, on a test copy of the QML
(no dialog, `applyFingering()` called from `onRun`). It does not cover the dialog UI.

Run locally:

    node tests/musescore-runtime.js --musescore "/Applications/MuseScore 4.app/Contents/MacOS/mscore"

On Linux prefix it with `xvfb-run -a`. If it fails, the full MuseScore output is saved
(path printed, or `SPF_RUNTIME_LOG`).
