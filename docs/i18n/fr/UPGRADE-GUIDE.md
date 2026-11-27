[Chinese](../../../UPGRADE-GUIDE.md) · [English](../en/UPGRADE-GUIDE.md) · [日本語](../ja/UPGRADE-GUIDE.md) · [한국어](../ko/UPGRADE-GUIDE.md) · [Deutsch](../de/UPGRADE-GUIDE.md) · **Français** · [Español](../es/UPGRADE-GUIDE.md)

# Guide de mise à jour (→ 1.8.0)

> S'applique à toute montée de version 1.x vers 1.8.0.

## 🚀 Mise à jour rapide

```bash
# archive de distribution (avec dépendances)
plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-1.8.0.tgz")
dsh restart
```

Avec npm : `npm install dsh-context-hub@1.8.0`, puis redémarrer DSH.

## 📋 Vérifications préalables

- Sauvegarder la mémoire : `cp ~/.dsh/context-hub/memory.db{,.bak}`.
- Vérifier Node.js ≥ 22.13 et DSH 0.2.x.
- Noter la version actuelle : `/context-hub status`.

## ✨ Nouvelles fonctions

- **Signaux mémoire explicites** : « retiens », « ne pas », « préfère », « à faire » sont écrits immédiatement, sans appel LLM.
- **Détection de conflits** : négations, changements numériques et transitions d'état sont détectés et reliés par supersede.
- **Vues mémoire** : `/context-hub graph <id>`, `/context-hub timeline [scope]`, `/context-hub conflicts <id>`.
- **Export/import JSONL** : `/context-hub export-jsonl` et `import-jsonl <chemin>` (idempotent par hash).
- **Langue** : `/context-hub locale [auto|zh|en|ja|ko|de|fr|es]`, aussi dans le panneau.

## 🔧 Évolutions de configuration

Nouvelles options : `reviewPolicy` (`off` / `low-confidence` / `layered`), `locale` (`auto` ou code de langue). Les options existantes gardent leurs valeurs par défaut ; aucune modification n'est requise.

```yaml
- id: dsh-context-hub
  config:
    reviewPolicy: layered
    locale: auto
```

## 🐛 Dépannage

- Panneau absent après mise à jour → rechargement forcé ; sinon `node --check client/client.js`.
- La langue ne change pas → redémarrer DSH (le plugin serveur se recharge), puis recharger la page.
- Mémoire indisponible → vérifier les droits de `$DSH_HOME/context-hub/memory.db` ; la session continue sans mémoire.

## 📊 Impact sur les performances

| Opération | Latence ajoutée |
| --- | --- |
| Écriture de signal explicite | ~0 ms |
| Détection de conflit | +50–200 ms |
| Révision par niveaux (LLM) | +200–500 ms |
| Génération du graphe | +500–2000 ms |

Le rappel vectoriel garde son empreinte (optionnel, désactivé par défaut).

## 🆚 Comparaison des versions

| Fonction | 1.7.x | 1.8.0 |
| --- | --- | --- |
| Signaux explicites | ❌ | ✅ |
| Détection de conflits | ❌ | ✅ |
| Graphe / chronologie / conflits | ❌ | ✅ |
| Export/import JSONL | ❌ | ✅ |
| Métriques de rappel honnêtes | ❌ | ✅ |
| Langues du panneau | ❌ | ✅ 7 langues |

## 📞 Aide

- Sortie de `dsh context-hub doctor`
- Versions DSH et Node.js, OS
- Journaux : `tail -n 50 ~/.dsh/logs/context-hub.log`
- Issues : https://github.com/ElementBen555/context-hub/issues

## 🎉 Terminé

Vérifier après la mise à jour :

```bash
/context-hub status
/context-hub doctor
/context-hub probe
/context-hub locale
```
