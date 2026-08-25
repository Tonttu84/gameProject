// Sanitizer options, COMPILED IN rather than set as environment variables.
//
// Same reasoning CFLAGS' `-fno-sanitize-recover=undefined` is written down with
// (see the Makefile): an option baked into the binary also covers a bare
// `./run_tests`, and it keeps a local run and a CI run identical. An
// ASAN_OPTIONS line in ci.yml would cover neither.
//
// The runtime reads these weak hooks at startup if they exist, so a build
// WITHOUT sanitizers simply never calls them — no guard needed.
//
// A real ASAN_OPTIONS / UBSAN_OPTIONS in the environment still wins for the
// keys it names, so an ad-hoc debugging run can override any of this.

extern "C" const char* __asan_default_options()
{
    // check_initialization_order + strict_init_order: catch a global in one
    // translation unit being read before its constructor has run.
    //
    // ADDED BECAUSE IT WOULD HAVE CAUGHT A REAL BUG, on 2026-08-25. The tiered
    // battle logging needed a unit-name lookup warmed early, and warming it
    // from a static initialiser made the test binary HANG at startup: building
    // the lookup constructs units, unit constructors call Utility::getRandom(),
    // and getRandom touches `mockValues`/`gen` — statics in another TU with no
    // guaranteed construction order.
    //
    // None of the sanitizers said a word, because it is not a memory-safety
    // error: statics are zero-initialised before dynamic initialisation, so the
    // read is of valid, allocated memory. What was wrong was the semantic state
    // of the object. This check is the one that names it, and it is OFF by
    // default. Verified against the actual bug: it reports
    // "initialization-order-fiasco" with the offending frame.
    return "check_initialization_order=1:strict_init_order=1";
}

extern "C" const char* __ubsan_default_options()
{
    // A UBSan report without a stack trace names the file and line of the
    // operation but not how execution got there, which for a deep engine call
    // (a spell effect reached through the cast walk, say) is the half that
    // matters. CFLAGS already makes UB fatal; this makes the abort readable.
    return "print_stacktrace=1";
}
