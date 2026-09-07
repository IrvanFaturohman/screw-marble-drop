#!/usr/bin/env bash
# Rebuild and republish to GitHub Pages.
#
# The CI workflow in .github/workflows/deploy.yml does this on every push, but
# pushing it needs the `workflow` OAuth scope. Until `gh auth refresh -s workflow`
# has been run once, this script is the manual equivalent.
set -euo pipefail
cd "$(dirname "$0")"

npm run validate                # a board with a bare crossing must not reach the page
npm run validate -- --level 2
npm run build

WT=$(mktemp -d)
git worktree add -q --detach "$WT"
(
  cd "$WT"
  # The branch survives from the last deploy; --orphan would refuse.
  git checkout -q --orphan ghp-tmp
  git rm -rq --cached . 2>/dev/null || true
  find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
)
cp -R dist/. "$WT"/
touch "$WT/.nojekyll"
(
  cd "$WT"
  git add -A
  git commit -q -m "Built prototype for GitHub Pages"
  git branch -qM gh-pages
  git push -q --force origin gh-pages
)
git worktree remove "$WT" --force
echo "published -> https://irvanfaturohman.github.io/screw-marble-drop/"
