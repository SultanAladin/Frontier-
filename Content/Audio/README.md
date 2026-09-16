# Frontier game audio content

Canonical source and master location for the experimental Audio Lab and eventual Project Zero integration.

```text
Content/Audio/
├── Ambience/   # cloud/air beds and world tone
├── Wind/       # calm, gust, storm, canyon variants
├── Foliage/    # trees, leaves and grass movement
├── Surfaces/   # rolling textures: sand, gravel, tarmac, wet road
├── Vehicles/   # engine idle, acceleration and pass-bys
├── Tires/      # rubber squeal and loose-surface scrubs
├── Impacts/    # hits, crashes, barriers and debris
└── Interface/  # menu feedback
```

## Delivery convention

- Master: WAV, PCM 16- or 24-bit, 48 kHz
- Ambience/rolling layers: stereo seamless loops
- Collision/UI events: mono one-shots or variation sets
- Leave headroom in source assets; Audio Lab exports gameplay copies normalized to −1 dB peak.
- Name files with lowercase kebab case, for example `wind-calm-breeze-01.wav`.
- Record provenance and usage rights before integration.

`manifest.json` is the editor catalogue. A `null` path is an intentional unfilled production slot. Replace it with a repository-relative URL from the editor, e.g. `../../Content/Audio/Wind/wind-calm-breeze-01.wav`.
