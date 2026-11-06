# Smart Piano Fingering 2.4.0

*Release date: 6 November 2026*

Smart Piano Fingering is a MuseScore 4 plugin that writes piano fingering (1–5) into your score for the right and the left hand. This release compares the plugin with the fingerings written by real pianists and makes one change to the algorithm based on the comparison.

## What's new

### Compared with real pianists

The plugin has been checked against the **PIG Dataset**, a collection of 150 classical pieces fingered by pianists:

> E. Nakamura, Y. Saito, K. Yoshii, "Statistical Learning and Estimation of Piano Fingering", *Information Sciences* 517, pp. 68–85, 2020. [doi:10.1016/j.ins.2019.12.068](https://doi.org/10.1016/j.ins.2019.12.068)

On the 30 pieces fingered by four to six pianists each (Bach, Mozart, Chopin):

| | agrees with an average pianist | agrees with at least one pianist |
|---|---|---|
| Pianists with each other | 72% | 91% |
| Smart Piano Fingering 2.4.0 | 62% | 83% |

Pianists often disagree with each other, so 100% is not possible. The plugin is not trained on these pieces. It is about as close to the pianists as the simpler statistical models in the paper, and a few points below the best trained one. Method and full results: [`tests/pig/RESULTS.md`](../tests/pig/RESULTS.md).

### More natural thumb passages

The comparison showed that the plugin stayed in a five-finger position, using the 4th and 5th fingers, more often than pianists do. It now passes the thumb under or moves the hand more readily. The change was chosen on one part of the dataset and confirmed on the other. Scales, arpeggios, chromatic passages and the other standard fingerings in the reference tests are unchanged.

### Thanks

The PIG Dataset is used for nonprofit evaluation only and is not distributed with the plugin. We thank Eita Nakamura, Yasuyuki Saito and Kazuyoshi Yoshii for making it available.

## Installation

Unzip `musescore-smart-piano-fingering-v2.4.0.zip` and copy the `smart-piano-fingering` folder into your MuseScore plugins folder (MuseScore 4: `Documents/MuseScore4/Plugins/`), replacing any previous version. Then enable the plugin in *Home → Plugins*.
