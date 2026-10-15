# Smart Piano Fingering 2.0.0

*Release date: 15 October 2026*

Smart Piano Fingering is a MuseScore 4 plugin that writes piano fingering (1–5) into your score for the right and the left hand.

Version 2.0.0 is built around one idea: **a fingering should be the one a piano teacher would write, not just the shortest movement of the hand.** The plugin now reads the music first. It recognises scales, arpeggios, chords and other familiar figures and fingers them as pianists are taught to. Only where the music leaves a real choice does it pick the most comfortable option for your hand.

## What the plugin recognises

### Scales

- All **12 major** keys and all **12 minor** keys, in the **harmonic**, **melodic** and **natural** forms.
- Both hands, **ascending and descending**, over one or more octaves, with the standard fingerings of the method books. For example, C major right hand is `1 2 3 1 2 3 4 1 2 3 1 2 3 4 5`; E♭ major right hand starts on 3; B major left hand starts on 4.
- The **melodic minor** is fingered in its raised form going up and in its natural form coming down. Where the raised sixth would fall under the thumb (F♯ and C♯ minor, right hand) the standard alternative is used.
- A scale is also recognised when it starts on another degree, uses any rhythm, or sits inside a longer melody.
- The **top note** of a run gets the outer finger (C major right hand ends `… 4 5`) only when the line really turns there. If the melody keeps rising, the thumb is kept for the next position.
- When the key signature is available, it helps tell apart keys that share the same notes. For example, a run from D to D in G major is fingered as G major.

### Other runs

- **Chromatic scales** use the classic fingering: 3 on the black keys, thumb on the white keys, and 2 on the second of two adjacent white keys (F and C in the right hand, E and B in the left).
- **Pentatonic** runs use groups of two and three fingers, keeping the thumb on white keys where possible.

### Five-finger positions

Figures that stay within a fifth are played without moving the hand. This covers neighbour notes, turns and Czerny-style patterns. For example, C D C E D F E G becomes `1 2 1 3 2 4 3 5`.

### Arpeggios

- **Major, minor, diminished and augmented triads**, **dominant and diminished sevenths**, and **inversions**, in both hands.
- C major: right hand `1 2 3 1 2 3 5`, left hand `5 4 2 1 4 2 1`.
- The crossing finger is 4 when the thumb passes a third and 3 when it passes a fourth. That is why the first inversion becomes `1 2 4 5`.
- Arpeggios that start on a black key begin as pianists do, for example D♭ major right hand `2 1 2 4 1 2 4`.

### Chords

Chords are fingered as hand shapes:

| triad | right hand | left hand |
|---|---|---|
| root position | 1-3-5 | 5-3-1 |
| first inversion | 1-2-5 | 5-3-1 |
| second inversion | 1-3-5 | 5-2-1 |

Seventh chords, octaves and doubled triads also get their usual shapes. Each chord is chosen together with what comes before and after it, so a progression such as I–IV–V7–I stays smooth.

### Broken chords

Alberti basses and similar accompaniment figures keep a stable chord shape, for example C–G–E–G as `5 1 3 1`. The shape follows the harmony when the chord changes.

### Repeated notes

- **Fast** repetitions change finger, usually towards the thumb: `4 3 2 1`, `3 2 1` or `2 1`.
- **Slow** repetitions keep the same finger.
- The weak fifth finger is avoided for repeated notes.

### Leaps

After a large jump the hand is repositioned. The landing finger is the one the following notes need: leaping into a scale or a five-finger position starts it with the right finger.

### Held notes and several voices

- A finger holding a note is never used for another key while the note sounds. For example, a held thumb under a moving upper voice gives `1 3 4 5`.
- An upper voice is not played with the same finger on two keys in a row.

## Technique built in

- **Thumb passages are treated as thumb passages.** Thumb under 3 or 4, and 3 or 4 over the thumb, are the normal way to continue a line. Crossings with the second finger are kept for short distances; crossings with the fifth are avoided.
- **Black keys depend on the context.**
  - In scales and melodic lines the thumb and the fifth finger stay off the black keys (D major has no thumb on F♯ or C♯).
  - In chords, black-key arpeggios and five-finger positions on black keys the thumb is perfectly normal (D♭ major chord: `1-3-5`; F♯ major arpeggio: `1 2 3 1 2 3 5`).
  - Fingers 2, 3 and 4 are always welcome on black keys, for example 4 on B♭ in F major.
- **The fifth finger** is kept for the outer notes of the hand rather than for notes inside a phrase.
- **Hand size** affects chords, stretches and arpeggios, but never the standard scale fingerings, which are the same for every hand. With a very small hand the plugin may choose a narrower chord shape or an arpeggio variant.

## Your own fingerings come first

With **Keep existing fingerings** switched on, the numbers already in the score are never changed. The plugin builds the rest of the fingering around them.

If an existing fingering is physically impossible, the final message tells you how many places need a look. The same happens when the score asks for something no hand can do, for example a chord wider than the selected hand size, or a note that would have to be held by a finger needed elsewhere. The plugin no longer hides these situations.

## Good to know

- **Articulation:** staccato is taken into account when MuseScore makes it available, because a detached note lets the same finger move to another key.
- **What is not read:** slurs, dynamics and accents. The metronome tempo is also not read: "fast" and "slow" are judged in note values.
- **Finger substitutions** (such as `4-5` on a held note) are not written.
- **Places where teachers differ:** sometimes more than one fingering is standard, for example the right hand in second-inversion arpeggios (`1 2 4 5` or `1 2 3 5`) or some left-hand black-key arpeggios. The plugin picks one of them.
- **Short or ambiguous figures:** a six-note scale fragment, or a white-key run without a clear key, is fingered by preference rather than by rule. These are the places most worth checking.
- The result is a **suggestion** for study and teaching. Please review it musically, especially in polyphonic passages.
- The calculation may take a few seconds on long scores. The dialog shows progress, and **Stop** writes nothing.
- One undo (`Ctrl+Z` / `Cmd+Z`) removes everything the plugin wrote.

## Quality

The fingerings were checked against a reference set of more than 300 standard cases taken from the piano method books: all scales in all keys and forms, chromatic scales, arpeggios and their inversions, chords, repeated notes, black-key situations, leaps, held notes and combinations such as chord → scale or scale → arpeggio. Every case matches the standard fingering or an accepted variant. The plugin was also run inside MuseScore 4 on Windows, macOS and Linux on a set of test scores; please report any fingering that looks unnatural to you.

## Installation

1. Copy `smart-piano-fingering.qml` and `smart-piano-fingering.png` into your MuseScore plugins folder (for MuseScore 4: `Documents/MuseScore4/Plugins/`).
2. Enable **Smart Piano Fingering** in *Home → Plugins*.
3. Open a score, choose the staves for the right and left hand and the hand size, then press **Apply**.

Work on a copy of your score the first time.

## Feedback

Please report fingerings that look unnatural on the [issue tracker](https://github.com/emanuelemerlo/smart-piano-fingering/issues). Include:

- the passage (a screenshot or a small score);
- the hand and hand size used;
- the fingering you would expect.

These reports are the most useful way to improve the plugin.
