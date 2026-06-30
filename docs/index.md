---
layout: home

hero:
  name: ccremote
  text: No longer in active development
  tagline: Superseded by Claude Code's built-in remote-control feature. For parallel sessions, use cctabs.
  image:
    src: /logo.svg
    alt: ccremote logo
  actions:
    - theme: brand
      text: Try cctabs for parallel sessions →
      link: https://cctabs.com
    - theme: alt
      text: Read the deprecation notice
      link: '#deprecation-notice'
---

## Deprecation notice

Two things landed that made ccremote redundant:

- **Claude Code now ships its own remote-control feature**, significantly better than the Discord + tmux workaround ccremote was built around.
- For driving **multiple Claude Code sessions in parallel** — the deeper use case behind ccremote — the right tool is now **[cctabs](https://cctabs.com)**: terminal tabs as the UI, native parallelism, fork/restore/resume, no tmux.

The published `ccremote` package remains installable and the source remains as-is for anyone still relying on it, but expect no further releases or bug fixes. The GitHub repository will be archived.

The original documentation is still available under [Guide](/guide/) and [GitHub](https://github.com/generativereality/ccremote) for historical reference.
