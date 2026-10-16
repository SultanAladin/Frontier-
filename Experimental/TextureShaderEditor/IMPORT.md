# Texture / shader editor — saved upstream application

Standalone **Alloy — Material, Pattern, Texture, Stamp & Baking Studio**, imported
under `Experimental/` for later use. It is not integrated into SolidArc, the
native editor, or the repository's existing build/preview configuration.

## Pinned source

- Repository: https://github.com/streamlinkinbox/Frontier
- Reported source branch: `arena/65748a88-frontier`
- Exact imported commit: `773b2f5a2672ae530accff000d65d779e9059b66`
- Commit: https://github.com/streamlinkinbox/Frontier/commit/773b2f5a2672ae530accff000d65d779e9059b66

This is the complete application snapshot, **not just the commit's changed files**:
React/Three.js source and assets, shaders, package files and lockfile, build and
browser-test scripts/configuration, documentation, upstream deliverables, and the
self-contained `site/index.html` are retained. Original upstream files are
unchanged, including its README and its existing root patch file. No upstream
Git history or nested `.git` directory is included.

`UPSTREAM_MANIFEST.json` records the Git blob SHA and byte size of all 300 upstream
files. Each archived file was checked against the exact commit's Git tree before
being copied. This import adds only this note and that manifest.

## For later

- Original application guide: [README.md](README.md).
- Embedded offline application: [site/index.html](site/index.html).
- Editable application entry: [index.html](index.html).

When development is needed, run in this folder:

```sh
npm ci
npm run studio
```

The upstream `studio` script builds and serves on port **5173**; see the original
README for other scripts. Dependencies were **not installed**, scripts were
**not executed**, and a new server was **not started** as part of this archival
import. Runtime/build behavior has not been revalidated here. Existing SolidArc
work remains separate and unchanged by the import.
