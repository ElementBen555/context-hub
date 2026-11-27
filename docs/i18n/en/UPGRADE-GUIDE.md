[Chinese](../../../UPGRADE-GUIDE.md) · **English** · [日本語](../ja/UPGRADE-GUIDE.md) · [한국어](../ko/UPGRADE-GUIDE.md) · [Deutsch](../de/UPGRADE-GUIDE.md) · [Français](../fr/UPGRADE-GUIDE.md) · [Español](../es/UPGRADE-GUIDE.md)

# Upgrade guide (→ 1.8.0)

> Applies when upgrading from any 1.x to 1.8.0.

## 🚀 Quick upgrade

```bash
# distribution tarball (includes dependencies)
plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-1.8.0.tgz")
dsh restart
```

Or with npm: `npm install dsh-context-hub@1.8.0` then restart DSH.

## 📋 Pre-upgrade checks

- Back up the memory store: `cp ~/.dsh/context-hub/memory.db{,.bak}`.
- Check Node.js ≥ 22.13 and DSH 0.2.x.
- Note current version: `/context-hub status`.

## ✨ New features guide

- **Explicit memory signals**: saying "remember", "don't", "prefer", "todo" writes immediately without an LLM call.
- **Conflict detection**: negations, numeric changes and state transitions are detected and linked via supersede.
- **Memory views**: `/context-hub graph <id>`, `/context-hub timeline [scope]`, `/context-hub conflicts <id>`.
- **JSONL export/import**: `/context-hub export-jsonl` and `import-jsonl <path>` (idempotent by hash).
- **Language**: `/context-hub locale [auto|zh|en|ja|ko|de|fr|es]`, also available in the panel.

## 🔧 Config updates

New options: `reviewPolicy` (`off` / `low-confidence` / `layered`), `locale` (`auto` or a language code). Existing options keep their defaults, so no config change is required.

```yaml
- id: dsh-context-hub
  config:
    reviewPolicy: layered
    locale: auto
```

## 🐛 Troubleshooting

- Panel missing after upgrade → hard refresh; if it persists, `node --check client/client.js`.
- Language does not change → restart DSH so the server-side plugin reloads, then refresh the page.
- Memory store unavailable → check `$DSH_HOME/context-hub/memory.db` permissions; the session keeps working without memory.

## 📊 Performance impact

| Operation | Added latency |
| --- | --- |
| Explicit signal write | ~0 ms |
| Conflict detection | +50–200 ms |
| Layered review (LLM) | +200–500 ms |
| Graph generation | +500–2000 ms |

Vector recall keeps its previous footprint (optional, off by default).

## 🆚 Version comparison

| Capability | 1.7.x | 1.8.0 |
| --- | --- | --- |
| Explicit signals | ❌ | ✅ |
| Conflict detection | ❌ | ✅ |
| Graph / timeline / conflicts | ❌ | ✅ |
| JSONL export/import | ❌ | ✅ |
| Honest recall metrics | ❌ | ✅ |
| Panel languages | ❌ | ✅ 7 languages |

## 📞 Get help

- `dsh context-hub doctor` output
- DSH and Node.js versions, OS
- Logs: `tail -n 50 ~/.dsh/logs/context-hub.log`
- Issues: https://github.com/ElementBen555/context-hub/issues

## 🎉 Done

Verify after upgrading:

```bash
/context-hub status
/context-hub doctor
/context-hub probe
/context-hub locale
```
