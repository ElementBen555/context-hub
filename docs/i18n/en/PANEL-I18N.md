[Chinese](../../../PANEL-I18N.md) · **English** · [日本語](../ja/PANEL-I18N.md) · [한국어](../ko/PANEL-I18N.md) · [Deutsch](../de/PANEL-I18N.md) · [Français](../fr/PANEL-I18N.md) · [Español](../es/PANEL-I18N.md)

# Panel language switching

The panel can be switched between languages at runtime; the choice is remembered per browser and synced to the memory store.

## Overview

- 7 languages: zh, en, ja, ko, de, fr, es.
- `auto` follows the browser language (`navigator.language`).
- Panel text, tables, buttons and tooltips all switch; no page reload needed.

## Steps

1. Open the panel (badge at the bottom of the sidebar, or Esc).
2. Click the **Language** tab.
3. Pick a language; the panel re-renders immediately.
4. The choice is stored in `localStorage` and written to the memory store when the server supports it.

## Features

- Immediate: state-driven, no reload and no DSH restart.
- Persisted: `localStorage` key `context-hub.locale`, plus `config:locale` in SQLite.
- Honest fallback: unknown keys fall back to English, then Chinese.
- Sub-components (tables, legends, buttons) read the same language via a module-level `tr()`.

## Command line

```bash
/context-hub locale            # show current language and list
/context-hub locale en         # switch to English
/context-hub locale auto       # follow the system language
```

## Supported languages

| Code | Language | Entries |
| --- | --- | --- |
| zh | 简体中文 | 257/257 |
| en | English | 257/257 |
| ja | 日本語 | 257/257 |
| ko | 한국어 | 257/257 |
| de | Deutsch | 257/257 |
| fr | Français | 257/257 |
| es | Español | 257/257 |

## Where it is stored

- Browser: `localStorage["context-hub.locale"]`.
- Server: memory store `kv` table, key `config:locale`.
- Verified by tests: `npm run test:panel-i18n` renders 7 languages × 5 tabs.

## Troubleshooting

- Nothing changes: hard refresh (`Ctrl+Shift+R`) to drop the cached JS bundle.
- Panel missing entirely: a client syntax error prevents the bundle from registering; run `node --check client/client.js`.
- Choice lost after restart: the server writes `config:locale` only when the running plugin supports it; restart DSH after upgrading.

## Related

- [README](README.md)
- [COMPATIBILITY](COMPATIBILITY.md)
- Word tables: `scripts/locale-data/*.json`
