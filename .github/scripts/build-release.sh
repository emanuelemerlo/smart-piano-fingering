#!/usr/bin/env bash
# Build the release package of Smart Piano Fingering.
#
#   .github/scripts/build-release.sh <version> [output dir]
#
# <version> is "2.3.0" or "v2.3.0". The script checks that the version is the same in
# the QML file, in docs/README.txt and in CHANGELOG.md, then writes to the output dir
# (default: dist/):
#
#   musescore-smart-piano-fingering-v<version>.zip
#       README.txt                              release notes + user guide (docs/README.txt)
#       LICENSE.txt                             GPL-3.0 (required when distributing the plugin)
#       smart-piano-fingering/
#           smart-piano-fingering.qml           the plugin
#           smart-piano-fingering.png           its MuseScore thumbnail
#   release-notes.md                            body of the GitHub release (from CHANGELOG.md)
#
# The folder inside the ZIP is copied as it is into the MuseScore plugins folder.
# Run it locally before tagging to check that a release would build.

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "usage: $0 <version> [output dir]" >&2
    exit 2
fi

VERSION="${1#v}"
TAG="v$VERSION"
OUT="${2:-dist}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() { echo "::error::$*" >&2; echo "ERROR: $*" >&2; exit 1; }

# ---- consistency checks ------------------------------------------------------------
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'$1' is not a version like 2.3.0 or v2.3.0"

for f in smart-piano-fingering.qml smart-piano-fingering.png docs/README.txt CHANGELOG.md LICENSE; do
    [ -s "$f" ] || fail "$f is missing or empty"
done

QML_VERSION="$(sed -n 's/^[[:space:]]*version:[[:space:]]*"\([^"]*\)".*/\1/p' smart-piano-fingering.qml | head -n 1)"
[ "$QML_VERSION" = "$VERSION" ] ||
    fail "smart-piano-fingering.qml declares version '$QML_VERSION', the release is $VERSION"

grep -q 'thumbnailName:[[:space:]]*"smart-piano-fingering.png"' smart-piano-fingering.qml ||
    fail "thumbnailName in the QML file does not point to smart-piano-fingering.png"

README_TITLE="$(head -n 1 docs/README.txt)"
[ "$README_TITLE" = "SMART PIANO FINGERING $VERSION" ] ||
    fail "docs/README.txt starts with '$README_TITLE', expected 'SMART PIANO FINGERING $VERSION'"

grep -q "^## \[$VERSION\]" CHANGELOG.md || fail "CHANGELOG.md has no '## [$VERSION]' section"

# ---- package -----------------------------------------------------------------------
ZIP_NAME="musescore-smart-piano-fingering-$TAG.zip"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/smart-piano-fingering"
cp smart-piano-fingering.qml smart-piano-fingering.png "$STAGE/smart-piano-fingering/"
# CRLF line endings, so that README.txt and LICENSE.txt also read well in Windows Notepad.
sed 's/\r$//; s/$/\r/' docs/README.txt > "$STAGE/README.txt"
sed 's/\r$//; s/$/\r/' LICENSE > "$STAGE/LICENSE.txt"

rm -f "$OUT/$ZIP_NAME"
(
    cd "$STAGE"
    # Fixed timestamps and order: the same commit always gives the same ZIP.
    find . -exec touch -h -d "@${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct)}" {} +
    zip -X -q "$OUT/$ZIP_NAME" README.txt LICENSE.txt smart-piano-fingering/ \
        smart-piano-fingering/smart-piano-fingering.qml smart-piano-fingering/smart-piano-fingering.png
)

# ---- release notes -----------------------------------------------------------------
REPO_URL="https://github.com/${GITHUB_REPOSITORY:-emanuelemerlo/smart-piano-fingering}"
NOTES="$OUT/release-notes.md"

# Previous release tag (for the comparison link), if any.
PREV_TAG="$({ git tag --list 'v[0-9]*'; echo "$TAG"; } | sort -V -u | grep -x -B 1 "$TAG" | grep -vx "$TAG" || true)"

{
    echo "# Smart Piano Fingering $VERSION"
    echo
    # The CHANGELOG section of this version, without its "## [x.y.z] - date" heading.
    awk -v ver="$VERSION" '
        index($0, "## [" ver "]") == 1 { on = 1; next }
        on && /^## \[/                 { exit }
        on                             { print }
    ' CHANGELOG.md | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}'
    echo
    echo "## Installation"
    echo
    echo "1. Download \`$ZIP_NAME\` and extract it."
    echo "2. Copy the \`smart-piano-fingering\` folder (it holds \`smart-piano-fingering.qml\` and \`smart-piano-fingering.png\`) into your MuseScore plugins folder (MuseScore 4: \`Documents/MuseScore4/Plugins/\`). If an older version is there, replace it."
    echo "3. Enable **Smart Piano Fingering** in *Home → Plugins*."
    echo
    echo "\`README.txt\`, in the ZIP, holds the release notes and the user guide. Work on a copy of your score the first time."
    if [ -f "docs/RELEASE-NOTES-$VERSION.md" ]; then
        echo
        echo "Detailed release notes: [docs/RELEASE-NOTES-$VERSION.md]($REPO_URL/blob/$TAG/docs/RELEASE-NOTES-$VERSION.md)."
    fi
    if [ -n "$PREV_TAG" ]; then
        echo
        echo "**Full changelog**: $REPO_URL/compare/$PREV_TAG...$TAG"
    fi
} > "$NOTES"

echo "Built $OUT/$ZIP_NAME"
unzip -l "$OUT/$ZIP_NAME"
echo "Release notes: $NOTES"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "version=$VERSION"
        echo "tag=$TAG"
        echo "zip=$OUT/$ZIP_NAME"
        echo "notes=$NOTES"
    } >> "$GITHUB_OUTPUT"
fi
