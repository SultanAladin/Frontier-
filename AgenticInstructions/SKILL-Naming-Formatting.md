//============================================================================================================================================
//                                                   SKILL-NAMING-FORMATTING.MD
//============================================================================================================================================
// 🧩 Single authoritative skill file — naming conventions, formatting rules, emoji set, and font/TOML rules for all Frontier source.

---

# SKILL — Naming & Formatting

## Naming

1. Every identifier: PascalCase, two-word `<Subject><Role>`. Role must be from the 20 authorised suffixes.
2. Authorised role suffixes: `Structure` · `Space` · `Index` · `Codec` · `Exchange` · `Interchange` · `Extension` · `Solver` · `Integrator` · `Classifier` · `Projection` · `Specification` · `Configuration` · `Criteria` · `Metrics` · `Scheduler` · `Queue` · `Sequence` · `Host` · `Panel` (discouraged — prefer `Host` / `Scheduler` / `Metrics`).
3. Banned words (identifiers, files, folders, comments): `Manager Handler Dispatcher Processor Controller Service Utility Helper Node Frame Module Core Data Info Object Item Thing Base Record Buffer Cache Pool Registry Pipeline Flow Apex Nexus Hub Oracle Titan Sentinel Vanguard Maestro Matrix Catalyst Vortex Aether Zenith Nova Horizon Genesis Odyssey`.
4. Boolean variables: no `is`/`has`/`can` prefix — use `Condition` / `Enabled` / `State` suffix (e.g. `OpenCondition`, `VisibilityEnabled`).
5. Math/physics quantities use real Unicode symbols (`β γ Δτ θ ω ∇`), not ASCII transliterations.
6. Third-party API names (`VkDeviceCreateInfo`, `ImGuiIO`, `GLFWwindow`) are exempt — mirror verbatim.
7. Vary role suffixes across the type system — use `Index` for buffer slots, `Codec` for encode/decode, `Projection` for coordinate transforms, `Space` for continuous realms. Do not give every struct the `Structure` suffix.

## Formatting

8.  File header: `//===` ruler exactly **142 chars** · filename ALL CAPS centred · `// 🧩 one-line description` · 1 blank line after.
9.  Section banners: `//---` ruler exactly **122 chars** · title ALL CAPS centred · 1 blank line before and after.
10. Indentation: 4 spaces per level · tabs forbidden · namespace body stays flat (no indent inside `namespace`).
11. Braces: Allman — opening brace on its own line at enclosing indent level.
12. Inline comments: vertically aligned as a column · unit always present in brackets `[m] [px] [ms] [-]` · format: `Type Name;   // [unit] - description`.
13. Assignments and struct fields: align `=` and field names into columns within a logical block; reset alignment on a new logical block.
14. Blank lines: 1 between functions · 1 before/after section banners · never more than 1 inside a function · no trailing whitespace.
15. Ordered steps: `①–⑩` one per line, aligned.
16. Parameters ≥ 4: one per line, types and names aligned vertically.

## Emoji — authorised set only, no others

| Glyph | Meaning | Where |
|---|---|---|
| 🧩 | Module / annotation-block description | File header line only |
| 🧱 | Type — class, struct, union | Markdown and banners only, never in source |
| 💡 | Insight or non-obvious reasoning | Comment or Markdown |
| ⚠️ | Warning — correct but easy to misuse | Comment or Markdown |
| 🔴 | Critical constraint or invariant | Comment or Markdown |
| 🐞 🐛 | Known bug | Comment or Markdown |
| 🚧 | Work in progress | Comment or Markdown |
| 🔍 | Debug-only path | Comment or Markdown |
| 🏷️ | Label or tag | Comment or Markdown |
| 📌 | Fixed reference point / pinned requirement | Comment or Markdown |
| 📍 | Location marker / position in a sequence | Comment or Markdown |
| 📎 | Attachment / cross-reference to another file or section | Comment or Markdown |
| 🎮 | Input / controller / interaction path | Comment or Markdown |

- No other emoji anywhere in source or Markdown.
- Limit use: at most one per file header, one per section that genuinely needs a marker, none in inline field comments.
- Use technical/functional emoji only — decorative or expressive emoji (✨ 🚀 💡outside notes 🎯) are banned.

## Condition Closure Comments

17. Every `if` / `else if` / `else` block carries a closure comment on its closing brace identifying the condition by name:

```cpp
if (OpenCondition)
{
    X = Y;              // [type] - reason
}                       // end OpenCondition
else if (DraggingCondition)
{
    X = Z;              // [type] - reason
}                       // end DraggingCondition
else
{
    X = W;              // [type] - reason
}                       // end else
```

18. Nested conditions number their closure comments: `// end Condition ①` · `// end Condition ②` etc.
19. Single-line conditionals that omit braces are exempt: `if (Count == 0) return;`

## Font / TOML

20. Font descriptors are `.toml` only — `FontCodec` auto-generates them at runtime; never hand-write or commit `.manifest` files.
21. Optical-size and variable-font suffixes (`_18pt` `_24pt` `[Display]` `VariableFont` `_wght`) are stripped before weight classification.
22. ImGui supports TTF and OTF only — WOFF/WOFF2 must be decompressed to TTF/OTF before loading.
23. TOML is refreshed automatically when any TTF in the family folder is newer than the cached descriptor.
