# Third-party notices

## PianoPlayer

The fingering algorithm in `smart-piano-fingering.qml` was originally derived from
**PianoPlayer** by Marco Musy (https://github.com/marcomusy/pianoplayer), distributed under
the MIT License, and has since been substantially modified and extended (JavaScript/QML port,
chord and multi-voice handling, held-note constraints, incremental generation, MuseScore adapter).

The MIT License requires that its copyright and permission notice be included in copies of
substantial portions of the software. Reproduce the upstream notice below, copied verbatim
from the `LICENSE` file of the PianoPlayer version you derived from:

```
MIT License

Copyright (c) 2017 Marco Musy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

MIT-licensed code is compatible with distribution under GPL-3.0-only; this notice is kept
alongside the project's own `LICENSE`.

## PIG Dataset (evaluation only)

The fingering algorithm is evaluated against the **PIG Dataset** (Piano Fingering Dataset) by
Eita Nakamura, Yasuyuki Saito and Kazuyoshi Yoshii
(https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/), as described in:

E. Nakamura, Y. Saito, K. Yoshii, "Statistical Learning and Estimation of Piano Fingering",
*Information Sciences*, vol. 517, pp. 68-85, 2020. https://doi.org/10.1016/j.ins.2019.12.068
(arXiv:1904.10237)

The dataset is available for nonprofit academic use and is **not** included in this repository
or in the plugin: `tests/pig/` only contains the code that reads it and the aggregate results
(match rates), never notes or fingerings from the dataset. The plugin is not trained on the data;
one weight of the algorithm (the five-finger position habit) was lowered after the comparison.
We thank the authors for providing the dataset.
