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

pids=()
shards=()
for ((i = 0; i < JOBS; i++)); do
    if [ -s "$TMPDIR/shard_$i.txt" ]; then
        "$BIN" -f "$TMPDIR/shard_$i.txt" > "$TMPDIR/out_$i.txt" 2>&1 &
        pids+=("$!")
        shards+=("$i")
    fi
done

status=0
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
