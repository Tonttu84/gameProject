#!/usr/bin/env bash
# Meta-test: verify that vendored .claude/skills/ content actually reaches other
# machines via git, instead of silently being swallowed by .gitignore's blanket
# `.claude/*` rule (the exact bug this script exists to catch — see the
# grill-me skill install, which needed an explicit unignore).
#
# Only proves something when run against a fresh checkout — CI's
# actions/checkout is a stand-in for "a different computer just cloned this
# repo," which is the scenario that actually matters. Running it against an
# uncommitted local working tree just tells you what you already know.
#
# Checks, per skill directory under .claude/skills/:
#   1. SKILL.md exists
#   2. SKILL.md is tracked by git (not gitignored, not merely present on disk)
#   3. SKILL.md's frontmatter `name:` matches the directory name
#   4. grill-me and grilling are both present — grill-me's SKILL.md body
#      delegates to grilling, so one without the other is a broken skill
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

check_tracked() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "FAIL: $file does not exist"
    fail=1
    return
  fi
  if ! git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
    echo "FAIL: $file exists on disk but is not tracked by git (check .gitignore)"
    fail=1
    return
  fi
  echo "OK:   $file is tracked"
}

check_name_matches_dir() {
  local dir="$1"
  local skill_md="$dir/SKILL.md"
  [ -f "$skill_md" ] || return 0
  local expected
  expected="$(basename "$dir")"
  local actual
  actual="$(sed -n 's/^name: *//p' "$skill_md" | head -1)"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $skill_md frontmatter name '$actual' does not match directory '$expected'"
    fail=1
    return
  fi
  echo "OK:   $skill_md frontmatter name matches directory"
}

for skill in grill-me grilling; do
  check_tracked ".claude/skills/$skill/SKILL.md"
  check_name_matches_dir ".claude/skills/$skill"
done

if [ -f .claude/skills/grill-me/SKILL.md ] && [ ! -f .claude/skills/grilling/SKILL.md ]; then
  echo "FAIL: grill-me is present without its grilling dependency"
  fail=1
fi
if [ -f .claude/skills/grilling/SKILL.md ] && [ ! -f .claude/skills/grill-me/SKILL.md ]; then
  echo "FAIL: grilling is present without grill-me (probably fine standalone, but unexpected here)"
  fail=1
fi

if ! grep -q 'grilling' .claude/skills/grill-me/SKILL.md; then
  echo "FAIL: grill-me/SKILL.md no longer references grilling — dependency may have been dropped"
  fail=1
else
  echo "OK:   grill-me/SKILL.md references grilling"
fi

exit "$fail"
