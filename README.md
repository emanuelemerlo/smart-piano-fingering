# Smart Piano Fingering

MuseScore plugin that calculates and inserts piano fingering numbers (`1`–`5`) for the right and left hands in a score.

> **Status:** initial public repository packaging. The plugin has not been automatically tested against every MuseScore release; validate it in the MuseScore version you use before applying it to important scores.

## Features

- Calculates fingerings for right and left hand staves.
- Offers hand-size presets: `XXS`, `XS`, `S`, `M`, `L`, `XL`, `XXL`.
- Can preserve existing fingerings or replace them.
- Can limit changes to the current selection when MuseScore exposes a range selection.
- Reads notes from all four voices on a staff and accounts for tied note continuations.
- Uses the active MuseScore system palette for light/dark UI themes.
- Inserts changes as a score command, so MuseScore Undo (`Ctrl+Z`) can revert the operation.

## Requirements

- MuseScore with support for QML plugins and the `MuseScore 3.0` plugin API import.
- A score must be open.
- The plugin uses Qt Quick Controls and Layouts, as supplied by the host MuseScore installation.

The source contains compatibility handling for MuseScore 3 and MuseScore 4 metadata, but this alone does not guarantee identical behavior on every version. See [Compatibility and testing](#compatibility-and-testing).

## Installation

1. Download `smart-piano-fingering.qml` and `smart-piano-fingering.png` from this repository (or download the repository ZIP).
2. Copy both files into a directory used for MuseScore plugins. The exact user plugin directory varies by operating system and MuseScore version; consult the documentation for your installed version.
3. In MuseScore, open the Plugins management dialog and enable **Smart Piano Fingering**. Restart MuseScore if the plugin list does not refresh.
4. Open a score and launch **Smart Piano Fingering** from the Plugins menu.

Keep the QML file and PNG thumbnail together. If MuseScore does not list the plugin, verify the plugin directory and check the MuseScore application log/console for QML errors.

## Usage

1. Open the score and launch the plugin.
2. Set the staff number for the right hand and, optionally, the left hand. The left-hand value `0` disables left-hand processing.
3. Choose a hand-size preset. These are heuristic presets, not a clinical or individually measured hand model.
4. Choose whether to keep existing fingerings. When enabled, existing simple finger numbers (`1`–`5`) are treated as anchors and are left unchanged.
5. Enable **Selection only** if a range selection is available and you want to restrict written fingerings to that range.
6. Click **Apply**. Review the result musically; use `Ctrl+Z` to undo the operation if needed.

### Important behavior notes

- The algorithm provides suggested fingerings; it cannot replace a pianist's judgement, and some passages may need manual correction.
- Selection filtering is applied when writing fingerings. The plugin may still read and calculate a larger staff sequence to preserve context for its algorithm.
- The plugin's handling of existing fingerings is designed around plain numeric finger labels. Other text formats are not recognized as numeric anchors.
- Always work on a copy or save your score before bulk changes.

## Files

| File | Purpose |
|---|---|
| `smart-piano-fingering.qml` | Plugin UI, fingering algorithm, and MuseScore adapter. |
| `smart-piano-fingering.png` | Plugin thumbnail referenced by the QML metadata. |
| `CHANGELOG.md` | Release history. |
| `LICENSE` | GNU General Public License v3.0 (GPL-3.0-only). |
| `AUTHORS.md` | Author and attribution information. |
| `CONTRIBUTING.md` | Contribution and validation guidance. |
| `SECURITY.md` | Responsible reporting guidance. |
| `.github/` | Issue templates, pull request template, and lightweight repository checks. |

## Compatibility and testing

This repository currently has no automated integration test harness because the plugin depends on MuseScore's embedded QML runtime and score API. The GitHub Actions workflow performs basic repository hygiene checks; it does **not** prove that the plugin runs correctly inside MuseScore.

Before publishing a release, manually verify at least:

- The plugin appears in the Plugins menu and opens without QML errors.
- Right-hand only, left-hand only, and two-staff operation.
- A single-staff score and a multi-staff score.
- Existing fingerings with **Keep existing fingerings** both enabled and disabled.
- A range selection with **Selection only** enabled.
- Chords, rests, multiple voices, and tied notes.
- Undo after applying the plugin.
- The MuseScore versions and operating systems you intend to support.

Record the exact MuseScore version, operating system, and test results in release notes. Do not claim a version as supported until it has been tested.

## Development

The plugin is implemented in a single QML file and embeds its JavaScript algorithm and MuseScore adapter. Edit `smart-piano-fingering.qml`, keeping the thumbnail filename in sync with `thumbnailName` in the plugin metadata.

There is no separate build step. To test changes, install the edited files in the local MuseScore plugin directory and run them against a disposable score.

## License

Smart Piano Fingering is distributed under the **GNU General Public License v3.0 only (GPL-3.0-only)**. See [`LICENSE`](LICENSE) for the complete license text.

Copyright (C) 2026 Emanuele Merlo.

The GPL-3.0-only license permits use, study, modification, and redistribution under its terms. When distributing the program or derivative works, recipients must comply with the GPL, including its applicable source-code and license-notice requirements. The license is provided without warranty.

Author and attribution details are available in [`AUTHORS.md`](AUTHORS.md).
