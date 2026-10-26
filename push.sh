#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
rm -rf dl
git add -A
git status --short
git -c core.pager=cat diff --cached --stat | tail -5
git commit -F commitmsg.tmp --quiet
rm -f commitmsg.tmp
echo "HEAD=$(git rev-parse --short HEAD)"
git push origin main
git tag -a v0.3.2 -m "v0.3.2: presets in the -f section, hardened breakpoint page, CI artifacts with tarballs + release publishing"
git push origin v0.3.2
echo "REMOTE=$(git ls-remote origin refs/heads/main refs/tags/v0.3.2)"