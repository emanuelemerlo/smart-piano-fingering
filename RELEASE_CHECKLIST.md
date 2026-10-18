# Release checklist

## Before tagging

- [ ] Set the release version in `smart-piano-fingering.qml` (`version:`) and `CITATION.cff`.
- [ ] Move the `[Unreleased]` entries of `CHANGELOG.md` to a `## [X.Y.Z] - date` section: it becomes the text of the GitHub release.
- [ ] Update `docs/README.txt` (release notes + user guide, shipped in the ZIP): its first line must be `SMART PIANO FINGERING X.Y.Z`.
- [ ] Optionally add `docs/RELEASE-NOTES-X.Y.Z.md`; the release links to it when it exists.
- [ ] Update the compatibility notes in `README.md`.
- [ ] Test installation and launch in each intended MuseScore version (see the manual checks in `CONTRIBUTING.md`: dialog, Stop, Undo).
- [ ] Review the score output manually for representative passages.
- [ ] Review license and third-party asset provenance.
- [ ] Check that the package builds: `.github/scripts/build-release.sh X.Y.Z` (writes `dist/`).

## Publishing

- [ ] Merge to `main`, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- [ ] The **Release** workflow checks the versions, runs the Node tests and the MuseScore tests on Windows, macOS and Linux, and publishes the release with `musescore-smart-piano-fingering-vX.Y.Z.zip` (`README.txt`, `LICENSE.txt`, `smart-piano-fingering/smart-piano-fingering.qml`, `smart-piano-fingering/smart-piano-fingering.png`).
- [ ] If it fails, fix on `main`, move the tag (`git tag -f vX.Y.Z && git push -f origin vX.Y.Z`) and push again, or rerun it from *Actions → Release → Run workflow*.
- [ ] Download the ZIP from the release and install it once in MuseScore.
