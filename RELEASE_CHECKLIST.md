# Release checklist

- [ ] Confirm the release version in plugin metadata and documentation (`node tests/qml-compat-check.js` compares the QML, `CITATION.cff` and `CHANGELOG.md` versions).
- [ ] The `Cross-platform tests` workflow is green on Linux, Windows and macOS for the commit to be tagged.
- [ ] Test installation and launch in each intended MuseScore version.
- [ ] Test both hands, single/multiple staves, multiple voices, chords, ties, existing fingerings, range selection, and Undo.
- [ ] Review the score output manually for representative passages.
- [ ] Confirm `smart-piano-fingering.png` is present and referenced correctly.
- [ ] Update `CHANGELOG.md` and the compatibility notes in `README.md`.
- [ ] Review license and third-party asset provenance.
- [ ] Create a single tag of the form `vX.Y.Z` (for example `v1.1.0`) on the final commit and publish GitHub release notes.
