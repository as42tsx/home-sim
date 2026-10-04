#!/bin/sh
# Assemble the Pages root. Chunks stay siblings of index.html (see dist/index.html).
# Usage: scripts/assemble-site.sh [dest]
# Default dest is ./_site. Pass an absolute directory to stage a copy.
set -eu
cd "$(dirname "$0")/.."
dest="${1:-_site}"
if [ ! -f dist/index.html ]; then
  echo "dist/index.html missing; run npm run build first" >&2
  exit 1
fi
rm -rf "$dest"
mkdir -p "$dest"
cp dist/index.html "$dest/index.html"
find dist -maxdepth 1 -type f ! -name 'index.html' -exec cp -t "$dest/" {} +
cp .nojekyll perf-blank.html "$dest/"
cp -a styles i18n schema templates rules vendor dev fixtures src "$dest/"
