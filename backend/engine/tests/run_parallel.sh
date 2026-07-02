#!/usr/bin/env bash
# Runs the Catch2 test binary as several parallel processes, sharding test
# cases round-robin across them. Catch2 v2's runner isn't thread-safe in this
# project (Utility::getBattlefield() / Utility::mockValues are process-wide
# statics shared by every test), so we parallelize across processes instead,
# each of which gets its own copy of that state.
set -euo pipefail

BIN="${1:-./run_tests}"
JOBS="${JOBS:-$(nproc)}"

if [ ! -x "$BIN" ]; then
    echo "error: test binary '$BIN' not found or not executable" >&2
    exit 1
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
status=0

# Catch2's list mode returns the listed count as its exit code, not a
# pass/fail status, so don't let `set -e` treat a nonzero count as failure.
"$BIN" --list-test-names-only > "$TMPDIR/all_tests.txt" || true
if [ ! -s "$TMPDIR/all_tests.txt" ]; then
    echo "error: no test cases listed by '$BIN --list-test-names-only'" >&2
    exit 1
fi

for ((i = 0; i < JOBS; i++)); do
    : > "$TMPDIR/shard_$i.txt"
done
i=0
while IFS= read -r line; do
    [ -z "$line" ] && continue
    # Catch2's test-spec parser treats a bare ',' as a pattern separator even
    # inside a quoted name, so names containing a literal comma (several do)
    # must have it backslash-escaped or they get silently dropped.
    escaped=$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/,/\\,/g')
    echo "$escaped" >> "$TMPDIR/shard_$((i % JOBS)).txt"
    i=$((i + 1))
done < "$TMPDIR/all_tests.txt"

# Verify every shard file round-trips through Catch2's own filter parser before trusting
# the run: a test name containing characters the -f parser treats as syntax (e.g. a literal
# '[' or ']' outside the leading position, which restarts parsing in tag-filter mode
# mid-name — this bit us once, see the "(minRow..maxRow)" test names in
# test_server_api.cpp, previously "[minRow, maxRow]") can silently resolve to zero matches
# instead of erroring. That's a dropped test with no visible symptom today, and a masked
# failure the day someone breaks that test — exactly what CI's use of test-serial instead
# of this script is meant to catch, so catch it here too instead of relying on that.
for ((i = 0; i < JOBS; i++)); do
    [ -s "$TMPDIR/shard_$i.txt" ] || continue
    # Catch2's list mode returns the listed count as its exit code (see the comment on the
    # first --list-test-names-only call above) — under pipefail that would otherwise abort
    # the script via set -e before the check below ever runs.
    resolved=$("$BIN" -f "$TMPDIR/shard_$i.txt" --list-test-names-only 2>/dev/null | wc -l || true)
    expected=$(wc -l < "$TMPDIR/shard_$i.txt")
    if [ "$resolved" -ne "$expected" ]; then
        echo "error: shard $i's filter file names $expected test(s) but resolved to $resolved — a test name likely contains characters Catch2's -f parser treats specially. Rename the offending test case(s)." >&2
        status=1
    fi
done
if [ "$status" -ne 0 ]; then
    exit "$status"
fi

pids=()
shards=()
for ((i = 0; i < JOBS; i++)); do
    if [ -s "$TMPDIR/shard_$i.txt" ]; then
        "$BIN" -f "$TMPDIR/shard_$i.txt" > "$TMPDIR/out_$i.txt" 2>&1 &
        pids+=("$!")
        shards+=("$i")
    fi
done

for pid in "${pids[@]}"; do
    wait "$pid" || status=1
done

for i in "${shards[@]}"; do
    cat "$TMPDIR/out_$i.txt"
done

# A test name the shard files couldn't express would be silently dropped
# rather than fail loudly, so treat that as a hard failure too.
if grep -l "Invalid Filter" "$TMPDIR"/out_*.txt > /dev/null 2>&1; then
    echo "error: one or more shard files contained an invalid test filter (see 'Invalid Filter' above) — some tests were not run" >&2
    status=1
fi

exit "$status"
