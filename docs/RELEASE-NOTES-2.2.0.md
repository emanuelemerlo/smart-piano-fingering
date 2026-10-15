# Smart Piano Fingering 2.2.0

*Release date: 15 October 2026*

Smart Piano Fingering is a MuseScore 4 plugin that writes piano fingering (1–5) into your score for the right and the left hand. This release replaces the hand-size presets with real hands, and keeps the hand in place when the music allows it. For a full description of what the plugin recognises, see the [2.0.0 release notes](RELEASE-NOTES-2.0.0.md) and the user guide (`README.txt`).

## What's new

### Choose your hand, not a size

The seven presets `XXS` … `XXL` are replaced by hand profiles. Each one is defined by the span between thumb and little finger, measured with the hand spread as far as possible on a table:

| profile | span | reaches (minimal comfort / comfortably) |
|---|---|---|
| Child, 5-8 years | 14.5 cm | a sixth / a fifth |
| Child, 9-12 years | 17 cm | a seventh / a sixth |
| Small hand | 19 cm | a seventh (an octave at the edge) / a sixth |
| Woman (default) | 20 cm | an octave / a seventh |
| Man | 22.5 cm | a ninth / an octave |
| Large hand | 24 cm | a tenth / a ninth |
| Custom... | your own span | tick **Child's hand** for a child |

The spans follow surveys of pianists' hands: the average adult male span is 22.6 cm, the female one 20.1 cm. The dialog shows how far the chosen hand reaches.

The old presets did not match real hands. `M`, the default, was the hand of an average woman: a normal adult male hand was closer to `L`, and `XXS` could not even reach a fourth.

### A child's hand is not a smaller adult hand

With a child's profile (or **Child's hand** ticked) the plugin also takes mobility into account:

- the long fingers open less;
- stretches strain sooner, especially between 3, 4 and 5;
- the thumb passage is shorter and harder;
- the fifth finger is weaker;
- quick repositioning is harder.

These values are estimates; feedback from teachers is welcome.

### Every stretch is judged for your hand

For each pair of fingers the plugin knows the widest chord your hand can play and the widest interval it plays without tension. A stretch costs only for the part beyond that comfortable span. So a man's hand plays `1-3` on a sixth where a child moves the hand, and a broken sixth is fingered `1-3` rather than `1-2`.

### The hand stays in place

A key that comes back after a few notes keeps its finger when the hand has not moved, and a repeated chord keeps its fingering. The thumb is no longer put on the bass of a left-hand figure (or on the top note of a right-hand one) when the other notes lie above it.

Example: *Venezia* (M. Saroglia, M. Martellotta), left hand, quavers:

| bar | notes | 2.1.0 (`M`) | 2.2.0 (*Woman* or *Man*) |
|---|---|---|---|
| 19 | F2 C3 A3 C3 A3 C3 | `5 3 1 5 1 4` | `5 3 1 3 1 3` |
| 20 | F2 C3 A3 C3 A3 C3 | `1 4 1 5 1 4` | `5 3 1 3 1 3` |
| 25 | G2 D3 B3 D3 B3 D3 | `1 4 1 5 1 4` | `5 3 1 3 1 3` |
| 31 | F2 F2 C3 A3 | `1 1 4 1` | `5 5 3 1` |

In 2.1.0 the C changed finger although the hand did not move, and from bar 20 the thumb took the bass with the 4 crossing over it.

### Held keys

While a finger holds a key, no other finger passes over or under it. Before, a key held by the 4 could have a higher key played by the 3 or by the thumb.

## Compatibility

- The *Woman* profile is the default and has the chord limits of the former `M`. Its fingerings are not identical to 2.1.0, because every stretch is now judged against the chosen hand.
- Scripts that pass the old names still work: `XXS`/`XS` → child 5-8, `S` → child 9-12, `M` → woman, `L` → man, `XL`/`XXL` → large hand.
- Standard scale and arpeggio fingerings are the same for every hand, as before.

## Quality

- 55 automated tests pass in Node, including the reference suite of 313 standard fingering cases. Compared with 1.1.0 there are no regressions, and canonical fingerings go from 58 to 284.
- The plugin is run inside MuseScore 4 on Windows, macOS and Linux on 20 test scenarios. One of them runs all six profiles and two custom hands set from the dialog.

## Installation

1. Copy `smart-piano-fingering.qml` and `smart-piano-fingering.png` into your MuseScore plugins folder (for MuseScore 4: `Documents/MuseScore4/Plugins/`). If an older version is there, replace it.
2. Enable **Smart Piano Fingering** in *Home → Plugins*.
3. Open a score, choose the staves for the right and left hand and your hand, then press **Apply**.

Work on a copy of your score the first time.

## Feedback

Please report fingerings that look unnatural on the [issue tracker](https://github.com/emanuelemerlo/smart-piano-fingering/issues), with the passage, the hand profile used, and the fingering you would expect.
