# docs/ — GitHub Pages root

Settings → Pages → Source: **Deploy from a branch**, branch `main` (or this branch), folder **/docs**.

```
docs/
├── index.html          SolidArc launcher                    https://sultanaladin.github.io/Frontier-/
└── solidarc/           Outliner · Viewport · Inspector      …/Frontier-/solidarc/
```

The deep link `…/Frontier-/?panel=solidarc` redirects to the panel.

`docs/solidarc/` is generated from `Editor/EditorTools/ParametricSketcher/Panel/`. Do not edit the published copy directly; run `Scripts/publish-pages.sh` after changing the canonical panel or bridge.
