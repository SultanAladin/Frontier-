//============================================================================================================================================
// 📦 Frontier/CLAUDE.md — Architecture, Naming, Formatting and Compilation Directives for Frontier Engine
//============================================================================================================================================

# Frontier Engine Directives

## 1. Architectural Philosophy & Integrity
- **Decoupled Architecture**: Frontier is an independent, high-performance Vulkan simulation and rendering engine.
- **Strict Role-Based Nomenclature**: Every class, struct, module, and folder strictly follows the two-word `<Subject><Role>` format.
- **No Banned Words**: Never use OOP/AI tropes or vague abstractions.
- **Fail-Fast Error Handling**: Expected domain failures are returned as `Refusal` or wrapped in `Deliver<T>`. No raw C++ exceptions crossing module seams.
- **Linear Memory Management**: Monotonic extents via `ByteSpace` with reset at Phase ⑭. No uncontrolled heap allocations during simulation or rendering loops.

---

## 2. Definitive Closed Role Suffixes (19 Authorized Roles)
1. `Sequence`      : Deterministic multi-step ordered execution.
2. `Codec`         : Bidirectional bit-level encoding and decoding.
3. `Exchange`      : Low-level C-ABI boundary and hardware transport.
4. `Interchange`   : High-level platform interop and network datagrams (e.g. EOS).
5. `Extension`     : Optional hardware, platform, or engine feature set.
6. `Solver`        : Mathematical constraint satisfaction and integration (Jolt, XPBD, Fluid).
7. `Integrator`    : Numerical differential equation advancing (ReSTIR, Photometrics, Acoustics).
8. `Classifier`    : Decision tree and capability discrimination (Hardware, Orientation).
9. `Projection`    : Coordinate space transformation and visibility mapping.
10. `Specification`: Mathematical and structural declarations.
11. `Configuration`: Runtime tunable parameters and subsystem setups.
12. `Criteria`     : Validation thresholds and filtering conditions.
13. `Structure`    : Spatial and physical topology representations.
14. `Space`        : Continuous coordinate realms and scalar fields (LevelSet, Clusters).
15. `Index`        : Direct spatial lookup and fast addressing structures.
16. `Metrics`      : Quantitative profiling counters and microsecond telemetry.
17. `Scheduler`    : Fiber work-stealing execution graphs and clock loops.
18. `Queue`        : Lock-free atomic FIFO / double-ended work queues.
19. `Panel`        : Immediate mode UI rendering overlays (ImGui).
20. `Host`         : Root coordinator and executable lifecycle entry point.

---

## 3. Forbidden Words (Strictly Banned)
`Manager`, `Handler`, `Processor`, `Controller`, `Service`, `Utility`, `Helper`, `Node`, `Frame`, `Module`,
`Core`, `System`, `Backend`, `Pass`, `Stage`, `Harness`, `Shell`, `Entity`, `Element`, `Subsystem`,
`Hierarchy`, `Data`, `Info`, `Object`, `Item`, `Thing`, `Kind`, `Base`, `flag`, `state`, `value`,
`Parent`, `Child`, `Sibling`, `Table`, `Map`, `Block`, `Digest`, `Model`, `Handle`, `Store`,
`Bridge`, `Atlas`, `Substrate`, `Fabric`, `Cache`, `Evaluator`, `Evaluate`, `Journal`, `Resolver`,
`Mesh`, `Pool`, `Registry`, `Catalog`, `Repository`, `Directory`, `Vault`, `Arena`, `Inventory`,
`Ledger`, `Plan`, `Filter`, `Grid`, `Array`, `Dispatcher`, `Memory`, `Buffer`, `Pipeline`, `Flow`,
`Composite`, `Compose`, `Composition`, `Allocation`, `Tier`, `Nesting`, `Stratum`, `Mip`, `Messenger`,
`Probe`, `Blend`, `History`, `Bake`, `Stamp`, `Contract`, `Outcome`, `Prelude`, `Cadence`, `Binding`,
`Submission`, `Footprint`, `Region`, `Tree`, `Vacancy`, `Ordinates`, `Draft`, `Draught`, `Paint`,
`Depot`, `Ordinal`, `Actor`, `Source`, `API`.

---

## 4. Formatting Standards
- **File Headers**: Exactly 142 characters wide (`//` followed by 140 `=` characters).
- **Section Banners**: Exactly 122 characters wide (`//` followed by 120 `-` characters).
- **Indentation**: 4 spaces everywhere. Tabs are strictly forbidden.
- **Braces**: Allman style (opening brace on a new line at enclosing indentation level).
- **Namespaces**: Flat indentation inside `namespace Frontier { ... }` (declarations at column 0).
- **Unit Annotations**: Vertically aligned comments with bracketed physical units `[m]`, `[s]`, `[kg]`, `[lux]`, `[rad]`, `[Hz]`, `[-]`.
- **Unicode Math Glyphs**: Use real mathematical symbols ($α, β, γ, Δτ, ν, ρ, θ, ω, \nabla, \phi, \Sigma$).
- **Single Accessor Conversion**: Use C++20 templated conversion accessors (`template<typename T> T Query() const` or conversion operators) instead of duplicating multiple method variants.

---

## 5. Build & Compilation Commands
- **Linux**: `make all` or `g++ -std=c++20 -O3 -Wall -Wextra ...`
- **Windows**: `cmake -B build && cmake --build build --config Release`
- **Development UI**: Compiled conditionally with `#ifdef FRONTIER_DEVELOPMENT`.
