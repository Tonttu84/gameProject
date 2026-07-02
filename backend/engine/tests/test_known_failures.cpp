// Known-failing tests: each TEST_CASE below defines DESIRED behavior for a real,
// identified engine bug that hasn't been fixed yet. They are tagged [.] (Catch2's
// "hidden" tag) so `make test` / `make test-serial` / CI stay green — this file
// exists so the bug and its expected-correct behavior aren't lost, not to hide it.
//
// Run them explicitly with: ./run_tests "[.]"
//
// MIGRATION RULE: once the underlying bug is fixed, move the TEST_CASE back to the
// file it came from (noted per-test below), remove the [.] tag, and delete it from
// here. Do not leave a fixed test sitting in this file.

#include "catch.hpp"
#include "units/Soldier.hpp"
#include "hex/HexGrid.hpp"
#include "Utility.hpp"
#include "BattleSetup.hpp"
