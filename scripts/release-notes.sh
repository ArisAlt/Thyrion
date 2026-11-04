#!/usr/bin/env bash
# Prints a release's notes: the section of CHANGELOG.md for that tag, from its
# "## vX.Y.Z" heading up to the next "## " heading. The release workflow puts
# them on the GitHub release page.
#
# A release without a section fails: up to v0.2.16 every release page was
# empty, and the notes were easy to forget. A pre-release (a tag with a
# suffix, such as v0.2.16-rc.1) without one gets a line saying what it is.
#
# usage: scripts/release-notes.sh <tag> [CHANGELOG.md]
set -euo pipefail

tag="${1:?usage: release-notes.sh <tag> [CHANGELOG.md]}"
changelog="${2:-CHANGELOG.md}"

notes="$(awk -v head="## $tag" '
  $0 == head || index($0, head " ") == 1 { found = 1; next }
  found && /^## / { exit }
  found { print }
' "$changelog")"

# Trim blank lines at either end.
notes="$(printf '%s\n' "$notes" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')"

if [ -n "$notes" ]; then
  printf '%s\n' "$notes"
elif [[ "$tag" == *-* ]]; then
  echo "Pre-release build for testing. See the notes of the release it leads to."
else
  echo "No section \"## $tag\" in $changelog: write the release notes there first." >&2
  exit 1
fi
