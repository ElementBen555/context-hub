[Chinese](../../../UPGRADE-GUIDE.md) · [English](../en/UPGRADE-GUIDE.md) · [日本語](../ja/UPGRADE-GUIDE.md) · [한국어](../ko/UPGRADE-GUIDE.md) · **Deutsch** · [Français](../fr/UPGRADE-GUIDE.md) · [Español](../es/UPGRADE-GUIDE.md)

# Upgrade-Anleitung (→ 1.8.0)

> Gilt für Upgrades von jeder 1.x-Version auf 1.8.0.

## 🚀 Schnelles Upgrade

```bash
# Verteilungs-Tarball (mit Abhängigkeiten)
plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-1.8.0.tgz")
dsh restart
```

Mit npm: `npm install dsh-context-hub@1.8.0`, dann DSH neu starten.

## 📋 Prüfungen vor dem Upgrade

- Speicher sichern: `cp ~/.dsh/context-hub/memory.db{,.bak}`.
- Node.js ≥ 22.13 und DSH 0.2.x prüfen.
- Aktuelle Version notieren: `/context-hub status`.

## ✨ Neue Funktionen

- **Explizite Erinnerungssignale**: „merke“, „nicht mehr“, „bevorzuge“, „TODO“ werden ohne LLM-Aufruf sofort gespeichert.
- **Konflikterkennung**: Verneinungen, Zahlenänderungen und Statuswechsel werden erkannt und per supersede verknüpft.
- **Erinnerungsansichten**: `/context-hub graph <id>`, `/context-hub timeline [scope]`, `/context-hub conflicts <id>`.
- **JSONL-Export/Import**: `/context-hub export-jsonl` und `import-jsonl <Pfad>` (idempotent per Hash).
- **Sprache**: `/context-hub locale [auto|zh|en|ja|ko|de|fr|es]`, auch im Panel.

## 🔧 Konfigurationsänderungen

Neue Optionen: `reviewPolicy` (`off` / `low-confidence` / `layered`), `locale` (`auto` oder Sprachcode). Bestehende Optionen behalten ihre Standardwerte; keine Änderung nötig.

```yaml
- id: dsh-context-hub
  config:
    reviewPolicy: layered
    locale: auto
```

## 🐛 Fehlersuche

- Panel fehlt nach dem Upgrade → hart neu laden; sonst `node --check client/client.js`.
- Sprache wechselt nicht → DSH neu starten (serverseitiges Plugin lädt neu), dann Seite neu laden.
- Speicher nicht verfügbar → Rechte von `$DSH_HOME/context-hub/memory.db` prüfen; die Sitzung läuft ohne Erinnerung weiter.

## 📊 Leistungsauswirkung

| Vorgang | Zusätzliche Latenz |
| --- | --- |
| Explizites Signal | ~0 ms |
| Konflikterkennung | +50–200 ms |
| Gestufte Prüfung (LLM) | +200–500 ms |
| Graph-Erzeugung | +500–2000 ms |

Vektor-Abruf bleibt unverändert (optional, standardmäßig aus).

## 🆚 Versionsvergleich

| Funktion | 1.7.x | 1.8.0 |
| --- | --- | --- |
| Explizite Signale | ❌ | ✅ |
| Konflikterkennung | ❌ | ✅ |
| Graph / Zeitlinie / Konflikte | ❌ | ✅ |
| JSONL-Export/Import | ❌ | ✅ |
| Ehrliche Abrufmetriken | ❌ | ✅ |
| Panel-Sprachen | ❌ | ✅ 7 Sprachen |

## 📞 Hilfe

- Ausgabe von `dsh context-hub doctor`
- DSH- und Node.js-Version, OS
- Logs: `tail -n 50 ~/.dsh/logs/context-hub.log`
- Issues: https://github.com/ElementBen555/context-hub/issues

## 🎉 Fertig

Nach dem Upgrade prüfen:

```bash
/context-hub status
/context-hub doctor
/context-hub probe
/context-hub locale
```
