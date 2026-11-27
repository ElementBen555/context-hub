[Chinese](../../../README.md) · [English](../en/README.md) · [日本語](../ja/README.md) · [한국어](../ko/README.md) · [Deutsch](../de/README.md) · **Français** · [Español](../es/README.md)

# dsh-context-hub · Context Hub

Un plugin qui réunit **compression, mémoire et analyse** dans un seul bundle DSH : une seule installation, aucun build côté hôte (JavaScript ESM pur), données dans SQLite local.

> Index de la documentation :
> - [docs/spec.md](../../spec.md) — spécification v1.0 (figée)
> - [docs/design.md](../../design.md) — architecture, flux de données, contrats DSH, modes de défaillance
> - [docs/COMPATIBILITY.md](COMPATIBILITY.md) — matrice de compatibilité
> - [docs/PANEL-I18N.md](PANEL-I18N.md) — changement de langue du panneau
> - Texte complet : [anglais](../en/README.md) / [chinois](../../../README.md)

## Pourquoi un seul au lieu de trois

Dans DSH, ces trois éléments sont trois étapes du même pipeline de contexte : la mémoire décide *ce qui doit passer dans une nouvelle session*, la compression *ce qu'on jette et ce qu'on garde quand la session déborde*, et l'analyse *comment savoir si les deux premiers font juste*. Ils partagent un stockage, un canal d'injection (`agent.inject()`) et une entrée de recherche ; les séparer ne crée que doublons et conflits.

## Capacités

| Capacité | Implémentation | Entrée |
| --- | --- | --- |
| Mémoire | `turn/end` extrait des mémoires structurées avec le modèle courant ; seuls les éléments au-dessus du seuil qualité sont écrits dans SQLite | automatique + `context_hub_remember` |
| Rappel | Hybride mots-clés + trigrammes FTS5 (synonymes, pondération de portée, décroissance temporelle), éventuellement cosinus vectoriel ; injection à l'étape suivante | automatique + `context_hub_search` |
| Qualité du rappel | `context_hub_probe` mesure le taux de succès top-k, `context_hub_explain` détaille les scores | `context_hub_probe` / `context_hub_explain` |
| Gouvernance | niveaux session/project/global, archivage TTL, éviction par capacité, supersede de conflit | automatique |
| Compression | Réutilise la compression native DSH ; avec `compactor: hub`, enveloppe `summarize()` (8 sections, repli en cas d'échec) | `/context-hub compact` |
| Résumés comme mémoires | Écoute `compaction/summary` et stocke les résumés en `kind=summary` | automatique |
| Recherche/restauration des zones repliées | Parcourt le journal complet de session et réinjecte le texte d'origine | `context_hub_history` / `context_hub_restore` |
| Dépliage au niveau message | `unfold` remplace le nœud de résumé par le texte d'origine pendant N étapes (requête modèle uniquement) | `context_hub_unfold` |
| Budgets stricts | Plafond de jetons (1200) et échéance totale (4000 ms) par injection ; rien n'est injecté en cas de dépassement | automatique |
| Analyse | Jetons surface/total, composition, réserve de sortie, repli, dernières requêtes, courbe de coût | `/context-hub status`, badge latéral + panneau |
| Audit | Suppression douce, remplacement explicite, chaîne d'audit, journal d'observation, export JSON | `/context-hub audit/log/export` |
| Relations | `memory_links` (related/supersedes), expansion 1 saut au rappel (≤1) | automatique + `explain` |
| Index des messages | `messages` + `messages_fts`, indexé de façon incrémentale ; rappel par texte même sans mémoire | automatique |
| Flux de révision | Avec `reviewPending=true`, les extractions peu fiables vont en attente | `/context-hub review` |

## Installation

```bash
# npm (depuis 1.8.0 ; paquet slim sans dépendances embed)
# plugin_manager install_bundle(target="dsh-context-hub@1.8.0")

# Archive de distribution (contient embed/node_modules ; chemin .tgz absolu)
# plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-<version>.tgz")
```

Après installation, le `package.json` du profil reçoit une dépendance et une entrée de bundle, et `cordis.patch.yml` reçoit `id: dsh-context-hub`. Recharger après modification des sources (sans réinstaller) :

```
plugin_manager set_plugin(target="include:dsh-context-hub", enabled=true)
```

> Remarque : `parameters` / `output.schema` de `ctx.tools.register` doivent être du JSON Schema standard (tableaux `required: [...]` sur les objets). `required: true` par propriété est le raccourci de `defineTool`.

## Vérifié

- **1.8.0** : tous les renforts P1/P2 (A1/A3/A4/B5/C4/C5/E4/A5/E3/E5/D4/D5), 5 nouvelles commandes, export/import JSONL, vues mémoire, document de compatibilité.
- **1.7.x** : compresseur du panneau native ⇄ hub persistant, erreurs 409 ; mesure des étapes de rappel, `rerank.reasoningEffort=low` −30 %.
- **1.6.6** : 100 k mémoires + 20 k messages : rank p50 85,6 ms / p95 99,8 ms / p99 106,6 ms, base 67 Mo, RSS 249 Mo.
- **1.6.0** : plafond de jetons et échéance, identité projet git (avec migration), dépliage par message.
- **1.5.3** : `multilingual-e5-small` porte zh-holdout R@5 à 100 %, LongMemEval anglais 12 questions à 83,3 %.
- Historique antérieur dans le [README chinois](../../../README.md).

## Utilisation

```
/context-hub status                  # analyse : pression / zones repliées / mémoire
/context-hub doctor                  # autodiagnostic : FTS5/vecteur/réécriture/réordonnancement
/context-hub search <mot-clé>        # chercher dans la mémoire long terme
/context-hub remember <contenu>      # écrire une mémoire manuellement
/context-hub history <mot-clé>       # chercher dans tout le journal de session
/context-hub restore <seqDébut> [seqFin]  # restaurer le texte replié (4000 caractères)
/context-hub unfold [id:<n>|seqDébut] [seqFin] [steps:<n>]
/context-hub explain <mot-clé>       # débogage du rappel : candidats et scores
/context-hub probe [n]               # sonde de taux de succès (10 par défaut)
/context-hub log [n]                 # chronologie des événements
/context-hub audit <id>              # chaîne d'audit
/context-hub forget <id>             # suppression douce
/context-hub supersede <id> <nouveau> # remplacement explicite
/context-hub export                  # export JSON (0600)
/context-hub compact                 # compresser immédiatement
/context-hub compactor <hub|native>  # changer de compresseur
/context-hub reembed                 # recalculer tous les vecteurs
/context-hub watermark [on|off]      # interrupteur de compression (persistant)
/context-hub config [clé] [valeur]
/context-hub review [approve|reject] <id>
/context-hub locale [auto|zh|en|ja|ko|de|fr|es]  # langue du panneau/des commandes
```

Panneau : après rechargement, un badge « anneau + pourcentage de contexte » apparaît en bas de la barre latérale. Un clic ouvre une carte de 640 px avec un en-tête KPI fixe et les onglets **Aperçu** (composition, courbe de coût, top 5 activité), **Mémoire** (actives/en attente/remplacées/archivées/index, graphiques, récentes, approbation), **Observation** (détail, activité, dernières requêtes), **Config** (budget/TTL/extraction, bascules sémantiques, compression, compresseur, mode, badges) et **Langue**. Échap ou clic sur le fond ferme ; rafraîchissement toutes les 10 s ; couleurs selon les jetons de thème DSH.

![Aperçu du panneau](../../panel-preview.png)

Les données viennent de `/api/context-hub.status` (authentifié par le service `connection`, 401 sinon). Interrupteurs : `POST /api/context-hub.watermark` ; écritures : `POST /api/context-hub.review` et `POST /api/context-hub.action`.

Outils côté modèle : `context_hub_search` / `remember` / `history` / `restore` / `decompress` / `unfold` / `status` / `doctor`, plus en lecture seule `explain` / `log` / `probe` / `abtest`.

## Configuration

Les valeurs par défaut sont dans `defaults` (`src/index.js`) et peuvent être remplacées par la config du plugin ou des variables d'environnement. Les principales :

| Option | Défaut | Plage |
| --- | --- | --- |
| `recallMaxItems` | 8 | 1–20 |
| `recallMaxChars` | 1800 | 200–8000 |
| `recallMaxTokens` | 1200 | 100–4000 (plafond de jetons par injection) |
| `recallTimeoutMs` | 4000 | 0–20000 (échéance totale, sinon aucune injection) |
| `recallCooldownTurns` | 6 | 0–20 |
| `sessionTtlDays` / `projectTtlDays` / `globalTtlDays` | 7 / 90 / 0 | 3·7·15·30 / 0–3650 / 0–3650 |
| `capacityPerScope` | 5000 | 100–100000 |
| `extractPassesPerTurn` | 2 | 1–10 |
| `admissionThreshold` | 0.6 | 0–1 |
| `conflictPolicy` | `evidence` | `evidence` / `recency` |
| `compactor` | `native` | `native` / `hub` |
| `mode` | `auto` | `auto` / `observe` / `assist` / `takeover` / `full` |
| `reviewPending` | false | extractions peu fiables en attente |
| `embedding.enabled` / `baseUrl` / `model` | false / vide / vide | point de terminaison compatible OpenAI |
| `embedding.fusion` | `weighted` | `weighted` / `rrf` |
| `rewrite.enabled` | false | réécriture de requête (repli) |
| `rerank.enabled` | false | réordonnancement LLM |
| `watermark.enabled` / `triggerRatio` / `retainTokens` | false / 0.7 / 20000 | compression au fil de l'eau |
| `unfold.steps` / `maxChars` | 3 / 8000 | budget de dépliage |

Tableau complet dans le [README anglais](../en/README.md#configuration). Les entrées installées se configurent via `config:` dans `cordis.patch.yml` (`insert:` uniquement à l'installation initiale).

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

### Service d'embedding local (fourni)

Pour ne pas envoyer les textes à une API externe, utilisez le répertoire `embed/` fourni (transformers.js + ONNX CPU, compatible OpenAI). Le dépôt contient `embed/node_modules/` (≈ 475 Mo) : aucun `npm install` après un clone. Seul le paquet npm (sans dépendances) nécessite :

```bash
cd embed && npm install --ignore-scripts
./start.sh                        # démarrage manuel : 127.0.0.1:11434
curl -s localhost:11434/health    # {"ok":true,...,"ready":true}
```

Si `embedding.baseUrl` pointe vers la boucle locale et que `embedding.autoStart` est vrai, le plugin démarre le service, interroge `/health` puis remplit les vecteurs ; un échec ne fait que dégrader. Les modèles sont dans `embed/.cache/Xenova/<model>/` (téléchargés au premier appel ; hors ligne via l'actif `dsh-context-hub-models-e5-q8.tar.gz`).

## Distribution et publication

- `files` de `package.json` : `src` / `client` / `cordis.patch.yml` / `locale` / `icon.svg` / `README.md` / `LICENSE` / `CHANGELOG.md` / `docs` / `scripts` / `test-smoke.mjs` / `embed/`.
- Métadonnées d'affichage : `locale/en.json` et `locale/zh.json` (`meta.title` / `meta.description`), `icon.svg` (610 B).
- Deux conditionnements : `npm pack` (slim, sans `embed/node_modules`) et `scripts/pack.sh` (`git archive`, avec dépendances intégrées, ≈ 157 Mo).
- État au 2026-11-27 : **npm 1.8.0 publié** (public, slim ≈ 280 ko).
- Archives : dernier `dist/dsh-context-hub-*.tgz` (version, nombre de fichiers, octets et SHA-256 selon `dist/INSTALL.md`).

## Données

- Chemin par défaut : `$DSH_HOME/context-hub/memory.db` (`~/.dsh` si `DSH_HOME` est absent).
- Remplacement : variable `DSH_CONTEXT_HUB_DB=/path/to/memory.db`.
- La mémoire est un **cache dérivé** : le journal de session est la seule vérité ; une base corrompue ou supprimée n'arrête jamais la session.

## Limites de conception (version actuelle)

- Ne remplace pas le service de compression par défaut : avec `compactor: native`, `compaction-basic` reste responsable et le plugin ne fait que déclencher et indexer ; avec `compactor: hub`, il enveloppe `summarize()` (sans réenregistrement, repli en cas d'échec).
- Le panneau n'écrit que la gouvernance, les interrupteurs et les budgets ; le contenu des mémoires n'est pas éditable, le contexte est en lecture seule.
- Aucun type d'événement de session personnalisé : seuls `user/message` et `turn/end`.
- Le rappel combine chevauchement de mots-clés et trigrammes FTS5, avec cosinus vectoriel et réécriture LLM optionnels ; toute indisponibilité dégrade automatiquement.
- La compression au fil de l'eau est désactivée par défaut ; avec `watermark.enabled: true`, le pre-step ne replie que le préfixe le plus ancien selon `triggerRatio` et `retainTokens`/`retainTurns`.
- Les échecs d'extraction ne produisent qu'un `logger.warn` et ne bloquent jamais la session.

## Feuille de route

- **1.8.0** : 12 renforts P1/P2 (écritures déterministes, classification des conflits, révision par niveaux, hygiène des requêtes, reçus de compression, boucle qualité, métriques honnêtes, doublons proches, vues, JSONL, compatibilité, portabilité).
- **1.7.x** : graphe 1 saut, journal de compression, compresseur du panneau, performances.
- **1.6.x** : plafonds d'injection, identité git, dépliage par message, distribution vendored.
- **1.5.x** : refonte du panneau, index des messages, embedder multilingue, retainTurns.
- Ensuite : rappel sémantique anglais, comportement par défaut de la compression, locale du panneau.

Non traité : qualité du rappel anglais (LongMemEval R@5 83,3 %), flux d'approbation des grandes compressions ; design/spec/comparison restent en chinois.
