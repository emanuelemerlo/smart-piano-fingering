# Contributing

Thanks for helping improve Smart Piano Fingering.

## Before opening an issue

- Check whether the issue has already been reported.
- Include the exact MuseScore version and operating system.
- Describe the score structure involved (number of staves, voices, chords, ties, and selection type).
- Provide minimal reproduction steps. Remove personal or copyrighted score content before attaching files.

## Pull requests

- Keep changes focused and explain the user-visible behavior change.
- Preserve compatibility with the Qt/QML APIs available in the intended MuseScore versions.
- Update `README.md` and `CHANGELOG.md` when behavior or user instructions change.
- Do not add dependencies without explaining why they are required.

## Validation

There is no standalone build process. Install the modified QML and thumbnail in a test MuseScore profile and run the manual checks in the README. Test on a disposable score and confirm Undo works. State clearly which MuseScore versions were tested; basic CI checks are not a substitute for host-application testing.


## License of contributions

By submitting a contribution intended for inclusion in this repository, you agree that it will be distributed under the project license, GNU GPL-3.0-only, unless the maintainers explicitly agree otherwise. Only submit material you have the right to contribute, and retain required third-party notices.
