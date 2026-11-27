[Chinese](../../../COMPATIBILITY.md) · [English](../en/COMPATIBILITY.md) · [日本語](../ja/COMPATIBILITY.md) · [한국어](../ko/COMPATIBILITY.md) · [Deutsch](../de/COMPATIBILITY.md) · **Français** · [Español](../es/COMPATIBILITY.md)

# Compatibilité et matrice d'environnement

> Version : 2026-11-27 · correspond à l'implémentation **1.8.1**
> Objectif : préciser les versions DSH, Node.js et OS prises en charge, et ce qui se dégrade proprement.

## 1. Dépendances principales

| Dépendance | Minimum | Recommandé | Remarque |
| --- | --- | --- | --- |
| DSH | 0.2.0 | dernier 0.2.x | utilise `cordis` et le service `compaction` |
| Node.js | 22.13.0 | 22.x ou 24.x LTS | nécessite `node:sqlite` et ESM |
| npm | 10.0 | 10.x / 11.x | uniquement pour installer les dépendances |

## 2. Modes d'installation

- **npm** : `npm install dsh-context-hub@<version>` (paquet slim, sans `embed/node_modules`).
- **Source** : `git clone` + `npm install` (Node ≥22.13).
- **Archive hors ligne** : la sortie de `scripts/pack.sh` contient `embed/node_modules`, aucune installation supplémentaire.

## 3. Systèmes d'exploitation

| OS | État | Remarque |
| --- | --- | --- |
| Linux x64 | ✅ pris en charge | binaires onnxruntime et sharp inclus |
| Linux arm64 | ✅ pris en charge | onnxruntime arm64 inclus, sharp non |
| macOS arm64 | ⚠️ partiel | onnxruntime présent, pas de darwin x64, pas de sharp |
| Windows x64 | ⚠️ partiel | onnxruntime présent, pas de sharp |

Le plugin est du JavaScript pur et fonctionne partout où DSH fonctionne ; seul le service vectoriel local optionnel dépend de binaires natifs.

## 4. Compatibilité DSH

| DSH | État |
| --- | --- |
| 0.2.x | ✅ pris en charge (cible principale) |
| < 0.2.0 | ❌ non pris en charge (pas d'API `compaction`) |

## 5. Compatibilité Node.js

| Node.js | État |
| --- | --- |
| 22.13+ | ✅ minimum requis (`node:sqlite` stable) |
| 24.x | ✅ testé |

## 6. Dépendances des fonctions optionnelles

| Fonction | Prérequis |
| --- | --- |
| Rappel vectoriel | point de terminaison `/embeddings` compatible OpenAI, ou `embed/` fourni |
| Réécriture de requête / réordonnancement | une route de modèle disponible pour l'agent |
| Résumés de compression | service `compaction` de DSH (natif) |

## 7. Limites connues

- Le paquet npm est slim ; les vecteurs locaux nécessitent `cd embed && npm install --ignore-scripts`.
- Le `sharp` fourni n'existe que pour Linux x64 ; macOS/Windows doivent installer leurs dépendances.
- `npm pack` exclut `node_modules` ; utiliser `scripts/pack.sh` pour un paquet avec dépendances.
- Le rappel sémantique anglais (LongMemEval R@5 83,3 %) est équivalent au lexical, pas meilleur.

## 8. Chemin de mise à jour

1. Sauvegarder la mémoire (`cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.bak`).
2. Remplacer le plugin (`plugin_manager install_bundle` ou `npm install`).
3. Redémarrer DSH pour recharger le plugin côté serveur.
4. Vérifier avec `/context-hub doctor`.

Les changements de schéma sont additifs ; aucune migration n'est nécessaire.

## 9. Dépannage

- **401 sur `/api/context-hub.status`** : route enregistrée mais requête non authentifiée ; le panneau interroge depuis une page connectée.
- **Panneau absent** : erreur de syntaxe du bundle client ; lancer `node --check client/client.js`.
- **`FTS5 unavailable`** : mettre à jour SQLite ; le rappel se dégrade en mots-clés.
- **Service vectoriel non prêt** : voir `embed/embed.log` et `curl localhost:11434/health`.

## 10. Couverture des tests

- `node test-smoke.mjs` — bout en bout côté serveur.
- `npm run test:panel-i18n` — 7 langues × 5 onglets du panneau.
- `npm run check:locales` — tables de mots synchronisées avec le client.
- `node scripts/docs-i18n-check.mjs` — localisation de la documentation.
- `node scripts/stress.mjs` / `scripts/concurrency.mjs` — échelle et concurrence.

## 11. Journal des versions

Voir [CHANGELOG.md](../../../CHANGELOG.md) et [RELEASE-1.8.0.md](../../../RELEASE-1.8.0.md).

## 12. Périmètre de support

Support communautaire via GitHub Issues, sans SLA. Joindre la sortie de `doctor`, les versions DSH/Node.js et l'OS.

## 13. Retours

Ouvrir une issue sur https://github.com/ElementBen555/context-hub/issues avec les étapes de reproduction et les logs.
