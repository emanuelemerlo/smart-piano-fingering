# Comparison with the PIG Dataset

The plugin's fingering is compared with the fingerings written by pianists in the **PIG Dataset**:

> E. Nakamura, Y. Saito, K. Yoshii, "Statistical Learning and Estimation of Piano Fingering",
> *Information Sciences*, vol. 517, pp. 68-85, 2020. https://doi.org/10.1016/j.ins.2019.12.068
> (arXiv:1904.10237). Dataset: https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/

The dataset (150 pieces, 309 fingerings) is for nonprofit academic use and is **not** part of this
repository. This page contains only aggregate match rates.

## Running

    PIG_DATASET=/path/to/PianoFingeringDataset_v1.2 node tests/pig/evaluate.js [--set test|train|all] [--sizes woman,man] [--out report.md]

Without `PIG_DATASET` the script only runs its self-test. `--details <dir>` writes the notes
where the plugin disagrees with every pianist, for local study: that output contains dataset
content and must stay out of the repository (`pig-details/` is in `.gitignore`).

## Method

- **Metrics** as in the paper: *M_gen* = agreement with each pianist, averaged; *M_high* =
  agreement with the closest pianist; *M_soft* = share of notes where the plugin's finger matches
  at least one pianist. Mean over pieces. A note matches when both hand and finger agree.
- **Ceiling**: every pianist compared with the others (the paper's "Human" row). Our 71.6 / 90.8
  match the paper's 71.4 / 90.8, which checks the reader and the metrics.
- **Test set**: the 30 pieces fingered by 4-6 pianists (Bach, Mozart, Chopin), as in the paper.
  The other 120 pieces (one or two pianists) were used to choose the one weight that was changed,
  so the test set was not used for tuning.
- **Input**: each hand is given the notes the first pianist assigned to it (the paper used the
  staff, so the plugin has a small advantage here). Times are converted to beats at 0.5 s per
  beat; 0.3 s and 0.8 s change M_gen by less than 0.2 points. No key signature is given.
  Substitutions (`3_1`) count by their first finger, as in the paper.
- The plugin is rule based and is **not trained** on the dataset.

## Results (test set, 30 pieces, 150 fingerings)

| | M_gen | M_high | M_soft |
|---|---|---|---|
| Pianists vs each other (ceiling) | 71.6 | 77.5 | 90.8 |
| Plugin 2.3.0 (woman) | 61.5 | 67.3 | 82.6 |
| **Plugin, five-finger habit 6 → 1.5 (woman)** | **61.9** | **67.0** | **83.2** |
| *Paper: 3rd-order HMM (trained)* | *64.5* | *71.0* | *85.5* |
| *Paper: 1st-order HMM / chord HMM / LSTM* | *61.7 / 61.2 / 61.3* | *68.3 / 67.7 / 66.1* | *82.8 / 81.7 / 82.8* |

Hand profiles change little (M_gen 61.4 *small*, 61.9 *woman*, 61.8 *man* and *large*): the
dataset does not record the pianists' hands, and these pieces are not wide-stretch repertoire.

On the 120 training pieces M_gen went from 62.1 to 62.6.

### By context (test set, woman profile, after the change)

| context | notes | plugin gen | plugin soft | pianists gen | pianists soft |
|---|---|---|---|---|---|
| chord | 4148 | 73.7 | 88.6 | 81.6 | 94.8 |
| turn | 2161 | 53.6 | 80.4 | 64.0 | 87.9 |
| black key | 1747 | 50.5 | 73.9 | 67.9 | 89.0 |
| other single | 1502 | 47.9 | 70.7 | 68.1 | 89.7 |
| scale run | 1355 | 55.2 | 80.9 | 63.7 | 87.1 |
| leap | 829 | 73.2 | 88.5 | 78.7 | 92.4 |
| repeated | 433 | 50.6 | 80.8 | 58.8 | 87.7 |
| arpeggio | 230 | 49.1 | 74.8 | 62.4 | 88.8 |

Contexts are a rough classification of single notes by their neighbours in the same hand
(step-wise run, thirds/fourths, leap over a fifth, change of direction, repetition); a note can be
in "black key" and in one of the others.

## Findings

- Without any training the plugin is at the level of the paper's first-order HMM, chord HMM and
  neural networks, about 2.5 points below the best trained model and 10 below the pianists.
- The largest gaps are on black keys and on melodic lines that are neither scales nor arpeggios
  ("other single", "turn"): there pianists agree with each other far more than with the plugin.
- On the training pieces the plugin used the 4th and 5th fingers more than pianists (5th: 22.9% of
  notes vs 19.1%) and the 2nd less (19.4% vs 22.6%), mostly by continuing upwards in a five-finger
  position (3-4, 4-5 on steps) where pianists pass the thumb or shift. Weakening the five-finger
  habit was the only weight with a consistent gain on both sets; other weights (crossings, black
  keys, comfort, rest position) moved M_gen by less than 0.15 points.
- The musical reference suite (scales, arpeggios, chromatic, method-book fingerings) is unchanged:
  313/313.
