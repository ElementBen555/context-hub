[Chinese](../../../COMPATIBILITY.md) · [English](../en/COMPATIBILITY.md) · [日本語](../ja/COMPATIBILITY.md) · [한국어](../ko/COMPATIBILITY.md) · **Deutsch** · [Français](../fr/COMPATIBILITY.md) · [Español](../es/COMPATIBILITY.md)

# Kompatibilität und Umgebungsmatrix

> Version: 2026-11-27 · entspricht Implementierung **1.8.1**
> Zweck: Welche DSH-, Node.js- und OS-Versionen unterstützt werden und was bei Ausfällen degradiert.

## 1. Kernabhängigkeiten

| Abhängigkeit | Minimum | Empfohlen | Hinweis |
| --- | --- | --- | --- |
| DSH | 0.2.0 | neuestes 0.2.x | nutzt `cordis` und den `compaction`-Dienst |
| Node.js | 22.13.0 | 22.x oder 24.x LTS | benötigt `node:sqlite` und ESM |
| npm | 10.0 | 10.x / 11.x | nur zum Installieren von Abhängigkeiten |

## 2. Installationswege

- **npm**: `npm install dsh-context-hub@<version>` (schlank, ohne `embed/node_modules`).
- **Quelle**: `git clone` + `npm install` (Node ≥22.13).
- **Offline-Tarball**: das Ergebnis von `scripts/pack.sh` enthält `embed/node_modules`, keine weitere Installation nötig.

## 3. Betriebssysteme

| OS | Status | Hinweis |
| --- | --- | --- |
| Linux x64 | ✅ voll unterstützt | onnxruntime und sharp enthalten |
| Linux arm64 | ✅ unterstützt | onnxruntime arm64 enthalten, sharp nicht |
| macOS arm64 | ⚠️ teilweise | onnxruntime vorhanden, kein darwin x64, kein sharp |
| Windows x64 | ⚠️ teilweise | onnxruntime vorhanden, kein sharp |

Das Plugin selbst ist reines JavaScript und läuft überall, wo DSH läuft; nur der optionale lokale Vektordienst braucht native Binaries.

## 4. DSH-Kompatibilität

| DSH | Status |
| --- | --- |
| 0.2.x | ✅ unterstützt (Hauptziel) |
| < 0.2.0 | ❌ nicht unterstützt (keine `compaction`-API) |

## 5. Node.js-Kompatibilität

| Node.js | Status |
| --- | --- |
| 22.13+ | ✅ Mindestversion (`node:sqlite` stabil) |
| 24.x | ✅ getestet |

## 6. Abhängigkeiten optionaler Funktionen

| Funktion | Voraussetzung |
| --- | --- |
| Vektor-Abruf | OpenAI-kompatibler `/embeddings`-Endpunkt oder mitgeliefertes `embed/` |
| Abfrage-Umschreibung / Neuordnung | eine dem Agenten verfügbare Modellroute |
| Komprimierungs-Zusammenfassungen | DSH-`compaction`-Dienst (nativ) |

## 7. Bekannte Einschränkungen

- Das npm-Paket ist schlank; lokale Vektoren brauchen `cd embed && npm install --ignore-scripts`.
- Das mitgelieferte `sharp` gibt es nur für Linux x64; macOS/Windows müssen Abhängigkeiten selbst installieren.
- `npm pack` schließt `node_modules` aus; für Abhängigkeiten im Paket `scripts/pack.sh` verwenden.
- Englischer semantischer Abruf (LongMemEval R@5 83,3 %) ist gleichwertig, nicht besser.

## 8. Upgrade-Pfad

1. Speicher sichern (`cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.bak`).
2. Plugin ersetzen (`plugin_manager install_bundle` oder `npm install`).
3. DSH neu starten, damit das serverseitige Plugin neu lädt.
4. Mit `/context-hub doctor` prüfen.

Schemaänderungen sind additiv; ein Migrationsschritt ist nicht nötig.

## 9. Fehlersuche

- **401 bei `/api/context-hub.status`**: Route registriert, Anfrage nicht authentifiziert; das Panel lädt von einer angemeldeten Seite.
- **Panel fehlt**: Syntaxfehler im Client-Bundle; `node --check client/client.js` ausführen.
- **`FTS5 unavailable`**: SQLite aktualisieren; der Abruf degradiert auf Schlüsselwörter.
- **Vektordienst nicht bereit**: `embed/embed.log` und `curl localhost:11434/health` prüfen.

## 10. Testabdeckung

- `node test-smoke.mjs` — End-to-End auf Serverseite.
- `npm run test:panel-i18n` — 7 Sprachen × 5 Panel-Tabs.
- `npm run check:locales` — Worttabellen synchron zum Client.
- `node scripts/docs-i18n-check.mjs` — Dokumentationslokalisierung.
- `node scripts/stress.mjs` / `scripts/concurrency.mjs` — Skalierung und Nebenläufigkeit.

## 11. Änderungsprotokoll

Siehe [CHANGELOG.md](../../../CHANGELOG.md) und [RELEASE-1.8.0.md](../../../RELEASE-1.8.0.md).

## 12. Supportumfang

Community-Support über GitHub Issues, kein SLA. Bitte `doctor`-Ausgabe, DSH-/Node.js-Version und OS-Details mitsenden.

## 13. Feedback

Issue unter https://github.com/ElementBen555/context-hub/issues mit Reproduktionsschritten und Logs öffnen.
