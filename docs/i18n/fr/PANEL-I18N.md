[Chinese](../../../PANEL-I18N.md) · [English](../en/PANEL-I18N.md) · [日本語](../ja/PANEL-I18N.md) · [한국어](../ko/PANEL-I18N.md) · [Deutsch](../de/PANEL-I18N.md) · **Français** · [Español](../es/PANEL-I18N.md)

# Changement de langue du panneau

Le panneau peut changer de langue à chaud ; le choix est mémorisé par navigateur et synchronisé avec le stockage.

## Aperçu

- 7 langues : zh / en / ja / ko / de / fr / es.
- `auto` suit la langue du navigateur (`navigator.language`).
- Textes, tableaux, boutons et infobulles changent ; aucun rechargement nécessaire.

## Étapes

1. Ouvrir le panneau (badge en bas de la barre latérale, ou Échap).
2. Cliquer sur l'onglet **Langue**.
3. Choisir une langue : le panneau se redessine immédiatement.
4. Le choix est stocké dans `localStorage` et écrit dans la mémoire quand le serveur le permet.

## Caractéristiques

- Immédiat : piloté par l'état, sans rechargement ni redémarrage de DSH.
- Persistant : clé `context-hub.locale` dans `localStorage`, plus `config:locale` en SQLite.
- Repli honnête : les clés inconnues tombent sur l'anglais, puis le chinois.
- Les sous-composants (tableaux, légendes, boutons) utilisent le même `tr()`.

## Ligne de commande

```bash
/context-hub locale            # langue actuelle et liste
/context-hub locale fr         # passer au français
/context-hub locale auto       # suivre la langue du système
```

## Langues prises en charge

| Code | Langue | Entrées |
| --- | --- | --- |
| zh | 简体中文 | 257/257 |
| en | English | 257/257 |
| ja | 日本語 | 257/257 |
| ko | 한국어 | 257/257 |
| de | Deutsch | 257/257 |
| fr | Français | 257/257 |
| es | Español | 257/257 |

## Où c'est stocké

- Navigateur : `localStorage["context-hub.locale"]`.
- Serveur : table `kv` de la mémoire, clé `config:locale`.
- Vérifié par `npm run test:panel-i18n` (7 langues × 5 onglets).

## Dépannage

- Rien ne change : rechargez en forçant (`Ctrl+Shift+R`) pour vider le JS en cache.
- Panneau absent : une erreur de syntaxe empêche l'enregistrement du bundle ; lancez `node --check client/client.js`.
- Choix perdu après redémarrage : `config:locale` n'est écrit que si le serveur le gère ; redémarrez DSH après la mise à jour.

## Voir aussi

- [README](README.md)
- [COMPATIBILITY](COMPATIBILITY.md)
- Tables de mots : `scripts/locale-data/*.json`
