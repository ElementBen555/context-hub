[Chinese](../../../PANEL-I18N.md) · [English](../en/PANEL-I18N.md) · [日本語](../ja/PANEL-I18N.md) · [한국어](../ko/PANEL-I18N.md) · **Deutsch** · [Français](../fr/PANEL-I18N.md) · [Español](../es/PANEL-I18N.md)

# Sprachumschaltung im Panel

Das Panel lässt sich zur Laufzeit umschalten; die Wahl wird pro Browser gemerkt und mit dem Speicher synchronisiert.

## Überblick

- 7 Sprachen: zh / en / ja / ko / de / fr / es.
- `auto` folgt der Browsersprache (`navigator.language`).
- Texte, Tabellen, Schaltflächen und Tooltips wechseln; kein Neuladen nötig.

## Schritte

1. Panel öffnen (Badge unten in der Seitenleiste oder Esc).
2. Tab **Sprache** anklicken.
3. Sprache wählen — das Panel zeichnet sofort neu.
4. Die Wahl liegt in `localStorage` und wird, wenn der Server es unterstützt, in den Speicher geschrieben.

## Eigenschaften

- Sofort: zustandsgetrieben, kein Reload und kein DSH-Neustart.
- Persistent: `localStorage`-Schlüssel `context-hub.locale` plus `config:locale` in SQLite.
- Ehrlicher Rückfall: unbekannte Schlüssel fallen auf Englisch, dann Chinesisch zurück.
- Unterkomponenten (Tabellen, Legenden, Schaltflächen) nutzen dasselbe `tr()`.

## Kommandozeile

```bash
/context-hub locale            # aktuelle Sprache und Liste
/context-hub locale de         # auf Deutsch wechseln
/context-hub locale auto       # Systemsprache folgen
```

## Unterstützte Sprachen

| Code | Sprache | Einträge |
| --- | --- | --- |
| zh | 简体中文 | 257/257 |
| en | English | 257/257 |
| ja | 日本語 | 257/257 |
| ko | 한국어 | 257/257 |
| de | Deutsch | 257/257 |
| fr | Français | 257/257 |
| es | Español | 257/257 |

## Speicherort

- Browser: `localStorage["context-hub.locale"]`.
- Server: `kv`-Tabelle des Speichers, Schlüssel `config:locale`.
- Geprüft durch `npm run test:panel-i18n` (7 Sprachen × 5 Tabs).

## Fehlersuche

- Keine Änderung: hart neu laden (`Strg+Shift+R`), um das gecachte JS zu verwerfen.
- Panel fehlt komplett: ein Syntaxfehler im Client verhindert die Registrierung; `node --check client/client.js` ausführen.
- Wahl nach Neustart verloren: `config:locale` wird nur von einer passenden Serverversion geschrieben; nach dem Upgrade DSH neu starten.

## Siehe auch

- [README](README.md)
- [COMPATIBILITY](COMPATIBILITY.md)
- Worttabellen: `scripts/locale-data/*.json`
