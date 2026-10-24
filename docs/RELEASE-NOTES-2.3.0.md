# Smart Piano Fingering 2.3.0

*Release date: 24 October 2026*

Smart Piano Fingering is a MuseScore 4 plugin that writes piano fingering (1–5) into your score for the right and the left hand. This release translates the dialog and shows the plugin version. The fingering is the same as in [2.2.0](RELEASE-NOTES-2.2.0.md).

## What's new

### The dialog speaks your language

The dialog, its messages and the plugin description follow the language of MuseScore's interface:

German, French, Italian, Spanish, Portuguese, Dutch, Polish, Czech, Swedish, Danish, Norwegian, Finnish, Hungarian, Romanian, Greek, Russian, Ukrainian, Chinese (Simplified and Traditional) and Japanese.

Regional variants use their language (Brazilian Portuguese the Portuguese dialog, Nynorsk the Norwegian one, Hong Kong Chinese the Traditional Chinese one). Any other language shows the English dialog. After changing the language in MuseScore's preferences, restart MuseScore.

The translations are built into the plugin file: there is nothing else to install. Corrections from native speakers are welcome (see `CONTRIBUTING.md`, *Translations*).

### The version is always visible

A badge in the top-right corner of the dialog shows the plugin version (*Version 2.3.0*, *Versione 2.3.0*, ...). Please mention it when you report a problem.

### Other changes

- The plugin is listed under MuseScore's standard **Composing/arranging tools** category in every MuseScore 4 version.
- Long option texts wrap inside the dialog instead of widening it.
- Release workflow: a version tag runs the tests on Windows, macOS and Linux and publishes the release package.

## Installation

Unzip `musescore-smart-piano-fingering-v2.3.0.zip` and copy the `smart-piano-fingering` folder into your MuseScore plugins folder (MuseScore 4: `Documents/MuseScore4/Plugins/`), replacing any previous version. Then enable the plugin in *Home → Plugins*.
