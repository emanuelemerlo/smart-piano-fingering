# Smart Piano Fingering 2.1.0

*Release date: 15 October 2026*

Smart Piano Fingering is a MuseScore 4 plugin that writes piano fingering (1–5) into your score for the right and the left hand. This release improves repeated notes and adds an option for how they are numbered. For a full description of what the plugin recognises, see the [2.0.0 release notes](RELEASE-NOTES-2.0.0.md) and the user guide (`README.txt`).

## What's new

### Repeated-note pedals keep one finger

A key repeated in one voice while another voice holds or moves is a **pedal**, and it is now played with the same finger throughout. This also applies where the pedal note sounds together with the other voice.

Example: Tchaikovsky, *Morning Prayer* op. 39 no. 1, bars 16–21. The left-hand G pedal in quavers used to get a different fingering in every bar:

| bar | 2.0.1 | 2.1.0 |
|---|---|---|
| 16 | `5 4 3 4 4 5` | `5 5 5 5 5 5` |
| 17 | `5 5 4 3 4 5` | `5 5 5 5 5 5` |
| 20 | `5 5 5 5 5 5` | `5 5 5 5 5 5` |
| 21 | `5 4 2 4 4 4` | `5 5 5 5 5 5` |

In bar 21 the old `2` on G also fell below the B♭ held by the `3`, so the two fingers crossed.

Fast repetitions in a single line still change finger (for example `4 3 2 1` on repeated semiquavers).

### New option: write the finger only when it changes

**Repeated notes: write the finger only when it changes** is on by default. When a key is struck again with the same finger, the number is written only on the first note, and again where the finger changes. In the Tchaikovsky example the pedal gets a single `5` at the start of bar 16, as in the printed edition.

Switch the option off to number every note. With **Selection only**, the number is written again on the first note inside the selection.

## Also included since 2.0.0

Version 2.0.1 was tagged without a separate release package. Its fixes are part of this release:

- An existing fingering that contradicts a recognised pattern (for example `5` on E in a C major scale) makes the surrounding notes follow it.
- Broken-chord accompaniments that change harmony every bar (C-E-G-E | G-B-D-B …) are fingered `5-3-1-3` in every bar.
- Needlessly cramped fingerings, such as `1-4` on a second, are avoided.

## Quality

- 48 automated tests pass in Node, including the reference suite of 306 standard fingering cases. There are no regressions compared with 2.0.1.
- The plugin is run inside MuseScore 4 on Windows, macOS and Linux on 20 test scenarios. One of them is a pedal under another voice, with the new option both on and off.

## Installation

1. Copy `smart-piano-fingering.qml` and `smart-piano-fingering.png` into your MuseScore plugins folder (for MuseScore 4: `Documents/MuseScore4/Plugins/`). If an older version is there, replace it.
2. Enable **Smart Piano Fingering** in *Home → Plugins*.
3. Open a score, choose the staves for the right and left hand and the hand size, then press **Apply**.

Work on a copy of your score the first time.

## Feedback

Please report fingerings that look unnatural on the [issue tracker](https://github.com/emanuelemerlo/smart-piano-fingering/issues), with the passage, the hand and hand size used, and the fingering you would expect.
