[Chinese](../../../README.md) · [English](../en/README.md) · [日本語](../ja/README.md) · [한국어](../ko/README.md) · **Deutsch** · [Français](../fr/README.md) · [Español](../es/README.md)

# dsh-context-hub · Kontext-Hub

Ein Plugin, das **Komprimierung, Erinnerung und Einblick** in einem DSH-Bundle vereint: einmal installieren, kein Build auf dem Host (reines ESM-JavaScript), Daten in lokalem SQLite.

> Dokumentationsindex:
> - [docs/spec.md](../../spec.md) — Funktionsspezifikation v1.0 (eingefroren)
> - [docs/design.md](../../design.md) — Architektur, Datenfluss, DSH-Verträge, Fehlermodi
> - [docs/COMPATIBILITY.md](COMPATIBILITY.md) — Kompatibilitätsmatrix
> - [docs/PANEL-I18N.md](PANEL-I18N.md) — Sprachumschaltung im Panel
> - Vollständige Beschreibung: [Englisch](../en/README.md) / [Chinesisch](../../../README.md)

## Warum eins statt drei

In DSH sind dies drei Stufen derselben Kontext-Pipeline: Erinnerung entscheidet, *was in eine neue Sitzung mitkommt*; Komprimierung entscheidet, *was wegfällt und was bleibt, wenn die Sitzung nicht mehr passt*; Einblick zeigt, *ob die ersten beiden richtig arbeiten*. Alle drei teilen Speicher, Injektionskanal (`agent.inject()`) und Sucheinstieg — getrennt entstehen nur Doppelarbeit und Konflikte.

## Funktionen

| Funktion | Umsetzung | Einstieg |
| --- | --- | --- |
| Erinnerung | `turn/end` extrahiert mit dem aktuellen Modell strukturierte Erinnerungen; nur Einträge über dem Qualitäts-Gate landen in SQLite | automatisch + `context_hub_remember` |
| Abruf | Hybrid aus Schlüsselwörtern + FTS5-Trigramm (Synonyme, Scope-Gewichtung, Zeitverfall), optional Vektor-Kosinus; Injektion im nächsten Schritt | automatisch + `context_hub_search` |
| Abrufqualität | `context_hub_probe` misst die Top-k-Trefferquote, `context_hub_explain` zeigt Bewertungen pro Eintrag | `context_hub_probe` / `context_hub_explain` |
| Governance | Ebenen session/project/global, TTL-Archivierung, Kapazitätsverdrängung, Konflikt-Supersede | automatisch |
| Komprimierung | Nutzt die native DSH-Komprimierung; mit `compactor: hub` wird `summarize()` umschlossen (8 Abschnitte, Rückfall bei Fehler) | `/context-hub compact` |
| Zusammenfassungen als Erinnerungen | Hört auf `compaction/summary` und speichert sie als `kind=summary` | automatisch |
| Suche/Wiederherstellung gefalteter Bereiche | Durchsucht das gesamte Sitzungsprotokoll und injiziert Originaltext erneut | `context_hub_history` / `context_hub_restore` |
| Nachrichtenweises Entfalten | `unfold` ersetzt den Zusammenfassungsknoten für N Schritte durch den Originaltext (nur Modellanfrage) | `context_hub_unfold` |
| Harte Budgets | Pro Injektion Token-Obergrenze (1200) und Gesamtfrist (4000 ms); bei Überschreitung keine Injektion | automatisch |
| Einblick | Surface/Gesamt-Tokens, Zusammensetzung, Ausgabereserve, Wasserstand, gefaltete Bereiche, letzte Anfragen, Kostkurve | `/context-hub status`, Seitenleisten-Badge + Panel |
| Audit | Soft-Delete, explizites Ersetzen, Audit-Kette, Beobachtungslog, JSON-Export | `/context-hub audit/log/export` |
| Beziehungen | `memory_links` (related/supersedes), 1-Hop-Erweiterung beim Abruf (≤1) | automatisch + `explain` |
| Nachrichtenindex | `messages` + `messages_fts`, inkrementell indexiert; Abruf auch ohne Erinnerungen | automatisch |
| Prüfablauf | Mit `reviewPending=true` gehen unsichere Extraktionen zuerst in „ausstehend“ | `/context-hub review` |

## Installation

```bash
# npm (ab 1.8.0; schlankes Paket ohne embed-Abhängigkeiten)
# plugin_manager install_bundle(target="dsh-context-hub@1.8.0")

# Verteilungs-Tarball (enthält embed/node_modules; absoluter .tgz-Pfad)
# plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-<version>.tgz")
```

Nach der Installation erhält die Profil-`package.json` eine Abhängigkeit und einen Bundle-Eintrag; `cordis.patch.yml` bekommt `id: dsh-context-hub`. Nach Quelländerungen neu laden (keine Neuinstallation):

```
plugin_manager set_plugin(target="include:dsh-context-hub", enabled=true)
```

> Hinweis: `parameters` / `output.schema` von `ctx.tools.register` müssen echtes JSON Schema sein (Objekte mit `required: [...]`-Array). `required: true` pro Eigenschaft ist die `defineTool`-Kurzform.

## Verifiziert

- **1.8.0**: alle P1/P2-Verstärkungen (A1/A3/A4/B5/C4/C5/E4/A5/E3/E5/D4/D5), 5 neue Befehle, JSONL-Export/Import, Erinnerungsansichten, Kompatibilitätsdokument.
- **1.7.x**: Panel-Kompressor native ⇄ hub, persistiert, Fehler → 409; Abruf-Timing, `rerank.reasoningEffort=low` spart 30 %.
- **1.6.6**: 100k Erinnerungen + 20k Nachrichten: rank p50 85,6 ms / p95 99,8 ms / p99 106,6 ms, DB 67 MB, RSS 249 MB.
- **1.6.0**: Injektions-Obergrenze und Frist, git-Projektidentität (mit Migration), nachrichtenweises Entfalten.
- **1.5.3**: `multilingual-e5-small` bringt zh-holdout R@5 auf 100 %, englische LongMemEval 12 Fragen 83,3 %.
- Ältere Versionen stehen im [chinesischen README](../../../README.md).

## Verwendung

```
/context-hub status                  # Einblick: Kontextdruck / gefaltete Bereiche / Speicher
/context-hub doctor                  # Selbsttest: FTS5/Vektor/Umschreiben/Neuordnung
/context-hub search <Stichwort>       # Langzeitspeicher durchsuchen
/context-hub remember <Inhalt>        # eine Erinnerung manuell schreiben
/context-hub history <Stichwort>      # vollständiges Sitzungsprotokoll durchsuchen
/context-hub restore <startSeq> [endSeq]  # gefalteten Text wiederherstellen (4000 Zeichen)
/context-hub unfold [id:<n>|startSeq] [endSeq] [steps:<n>]
/context-hub explain <Stichwort>      # Abruf-Debug: Kandidaten und Bewertungen
/context-hub probe [n]               # Trefferquoten-Probe (Standard 10)
/context-hub log [n]                 # Ereignis-Zeitleiste
/context-hub audit <id>              # Audit-Kette
/context-hub forget <id>             # Soft-Delete
/context-hub supersede <id> <neu>    # explizites Ersetzen
/context-hub export                  # JSON-Export (0600)
/context-hub compact                 # sofort komprimieren
/context-hub compactor <hub|native>  # Kompressor wechseln
/context-hub reembed                 # alle Vektoren neu berechnen
/context-hub watermark [on|off]      # Wasserstand-Schalter (persistiert)
/context-hub config [Schlüssel] [Wert]
/context-hub review [approve|reject] <id>
/context-hub locale [auto|zh|en|ja|ko|de|fr|es]  # Sprache für Panel/Befehle
```

Panel: Nach dem Neuladen erscheint unten links ein Badge („Ring + Kontext-Prozent“). Klick öffnet eine 640-px-Karte mit festem KPI-Kopf und den Tabs **Übersicht** (Zusammensetzung, Kostkurve, Top-5-Aktivität), **Speicher** (aktiv/ausstehend/ersetzt/archiviert/Index, Diagramme, letzte Einträge, Freigabe), **Beobachtung** (Details, Aktivität, letzte Anfragen), **Konfiguration** (Budget/TTL/Extraktion, semantische Schalter, Wasserstand, Kompressor, Modus, Fähigkeits-Chips) und **Sprache**. Esc oder Klick auf den Hintergrund schließt; Aktualisierung alle 10 s; Farben folgen den DSH-Theme-Tokens.

![Panel-Vorschau](../../panel-preview.png)

Daten kommen von `/api/context-hub.status` (Authentifizierung über den `connection`-Dienst, ohne Anmeldung 401). Schalter: `POST /api/context-hub.watermark`, Schreibvorgänge: `POST /api/context-hub.review` und `POST /api/context-hub.action`.

Modellseitige Werkzeuge: `context_hub_search` / `remember` / `history` / `restore` / `decompress` / `unfold` / `status` / `doctor` sowie schreibgeschützt `explain` / `log` / `probe` / `abtest`.

## Konfiguration

Standardwerte stehen in `defaults` in `src/index.js` und lassen sich per Plugin-Config oder Umgebungsvariable überschreiben. Die wichtigsten:

| Option | Standard | Bereich |
| --- | --- | --- |
| `recallMaxItems` | 8 | 1–20 |
| `recallMaxChars` | 1800 | 200–8000 |
| `recallMaxTokens` | 1200 | 100–4000 (Token-Obergrenze pro Injektion) |
| `recallTimeoutMs` | 4000 | 0–20000 (Gesamtfrist, danach keine Injektion) |
| `recallCooldownTurns` | 6 | 0–20 |
| `sessionTtlDays` / `projectTtlDays` / `globalTtlDays` | 7 / 90 / 0 | 3·7·15·30 / 0–3650 / 0–3650 |
| `capacityPerScope` | 5000 | 100–100000 |
| `extractPassesPerTurn` | 2 | 1–10 |
| `admissionThreshold` | 0.6 | 0–1 |
| `conflictPolicy` | `evidence` | `evidence` / `recency` |
| `compactor` | `native` | `native` / `hub` |
| `mode` | `auto` | `auto` / `observe` / `assist` / `takeover` / `full` |
| `reviewPending` | false | unsichere Extraktionen in „ausstehend“ |
| `embedding.enabled` / `baseUrl` / `model` | false / leer / leer | OpenAI-kompatibler Endpunkt |
| `embedding.fusion` | `weighted` | `weighted` / `rrf` |
| `rewrite.enabled` | false | Abfrage-Umschreibung (Rückfall) |
| `rerank.enabled` | false | LLM-Neuordnung |
| `watermark.enabled` / `triggerRatio` / `retainTokens` | false / 0.7 / 20000 | Wasserstand |
| `unfold.steps` / `maxChars` | 3 / 8000 | Entfaltungsbudget |

Die vollständige Tabelle steht im [englischen README](../en/README.md#configuration). Installierte Einträge werden über `config:` in `cordis.patch.yml` konfiguriert (`insert:` nur bei Erstinstallation).

```yaml
- id: dsh-context-hub
  config:
    compactor: hub
    embedding:
      enabled: true
      baseUrl: https://api.example.com/v1
      model: text-embedding-3-small
      apiKeyEnv: MY_EMBED_KEY
```

### Lokaler Embedding-Dienst (mitgeliefert)

Wer Erinnerungstexte nicht an eine externe API senden will, nutzt das mitgelieferte `embed/` (transformers.js + ONNX CPU, OpenAI-kompatibel). Das Repository enthält `embed/node_modules/` (ca. 475 MB), nach dem Klonen ist keine weitere Installation nötig; nur das npm-Paket (ohne Abhängigkeiten) braucht:

```bash
cd embed && npm install --ignore-scripts
./start.sh                        # manuell: 127.0.0.1:11434
curl -s localhost:11434/health    # {"ok":true,...,"ready":true}
```

Zeigt `embedding.baseUrl` auf Loopback und ist `embedding.autoStart` wahr, startet das Plugin den Dienst selbst, pollt `/health` und füllt danach Vektoren. Fehler führen nur zu Degradierung. Modelle liegen in `embed/.cache/Xenova/<model>/` (Download beim ersten Aufruf; offline nutzbar über das Release-Asset `dsh-context-hub-models-e5-q8.tar.gz`).

## Verteilung und Release

- `package.json`-`files`: `src` / `client` / `cordis.patch.yml` / `locale` / `icon.svg` / `README.md` / `LICENSE` / `CHANGELOG.md` / `docs` / `scripts` / `test-smoke.mjs` / `embed/`.
- Anzeige-Metadaten: `locale/en.json` und `locale/zh.json` mit `meta.title` / `meta.description`, `icon.svg` (610 B).
- Zwei Paketierungen: `npm pack` (schlank, ohne `embed/node_modules`) und `scripts/pack.sh` (`git archive`, mit vendored Abhängigkeiten, ca. 157 MB).
- Stand 2026-11-27: **npm 1.8.0 veröffentlicht** (public, schlank ca. 280 kB).
- Verteilung: `dist/dsh-context-hub-*.tgz` (Version, Dateizahl, Bytes und SHA-256 laut `dist/INSTALL.md` zum Release-Zeitpunkt).

## Daten

- Standardpfad: `$DSH_HOME/context-hub/memory.db` (`~/.dsh`, wenn `DSH_HOME` nicht gesetzt ist).
- Überschreiben: Umgebungsvariable `DSH_CONTEXT_HUB_DB=/path/to/memory.db`.
- Erinnerung ist ein **abgeleiteter Cache**: das Sitzungsprotokoll ist die einzige Wahrheit; eine beschädigte oder gelöschte Datenbank stoppt die Sitzung nie.

## Designgrenzen (aktuelle Version)

- Ersetzt standardmäßig den Komprimierungsdienst nicht: mit `compactor: native` bleibt `compaction-basic` zuständig, das Plugin triggert und indiziert nur; mit `compactor: hub` wird `summarize()` umschlossen (keine Neuregistrierung, Rückfall bei Fehler).
- Das Panel schreibt nur Governance, Schalter und Budgetparameter; Erinnerungsinhalte werden nicht bearbeitet, Kontextdaten sind schreibgeschützt.
- Keine eigenen Sitzungsereignistypen: nur `user/message` und `turn/end`.
- Abruf ist Schlüsselwortüberlappung + FTS5-Trigramm, optional mit Vektor-Kosinus und LLM-Umschreibung; fällt etwas aus, wird automatisch degradiert.
- Wasserstand ist standardmäßig aus; mit `watermark.enabled: true` wird im Pre-Step nach `triggerRatio` und `retainTokens`/`retainTurns` nur das älteste Präfix gefaltet.
- Extraktionsfehler erzeugen nur `logger.warn` und blockieren nie die Sitzung.

## Roadmap

- **1.8.0**: 12 P1/P2-Verstärkungen (deterministische Schreibvorgänge, Konfliktklassifizierung, gestufte Prüfung, Abfragehygiene, Komprimierungsbelege, Qualitätsschleife, ehrliche Metriken, Duplikaterkennung, Ansichten, JSONL, Kompatibilität, Portabilität).
- **1.7.x**: Graph 1-Hop, Komprimierungsjournal, Panel-Kompressor, Performance.
- **1.6.x**: Injektionsgrenzen, git-Identität, nachrichtenweises Entfalten, vendored Verteilung.
- **1.5.x**: Panel-Neubau, Nachrichtenindex, mehrsprachiger Embedder, Wasserstand-retainTurns.
- Danach: englischer semantischer Abruf, Wasserstand-Standardverhalten, Panel-Locale.

Offen: englische Abrufqualität (LongMemEval R@5 83,3 %), Freigabefluss für große Wasserstandsfaltungen; design/spec/comparison nur auf Chinesisch.
