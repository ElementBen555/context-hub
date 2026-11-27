[Chinese](../../../PANEL-I18N.md) · [English](../en/PANEL-I18N.md) · [日本語](../ja/PANEL-I18N.md) · [한국어](../ko/PANEL-I18N.md) · [Deutsch](../de/PANEL-I18N.md) · [Français](../fr/PANEL-I18N.md) · **Español**

# Cambio de idioma del panel

El panel puede cambiar de idioma en caliente; la elección se recuerda por navegador y se sincroniza con el almacén.

## Resumen

- 7 idiomas: zh / en / ja / ko / de / fr / es.
- `auto` sigue el idioma del navegador (`navigator.language`).
- Textos, tablas, botones e información emergente cambian; no hace falta recargar.

## Pasos

1. Abrir el panel (distintivo abajo en la barra lateral, o Esc).
2. Pulsar la pestaña **Idioma**.
3. Elegir idioma: el panel se redibuja al instante.
4. La elección se guarda en `localStorage` y se escribe en la memoria si el servidor lo admite.

## Características

- Inmediato: basado en estado, sin recargar ni reiniciar DSH.
- Persistente: clave `context-hub.locale` en `localStorage`, más `config:locale` en SQLite.
- Repliegue honesto: las claves desconocidas caen a inglés y luego a chino.
- Los subcomponentes (tablas, leyendas, botones) usan el mismo `tr()`.

## Línea de comandos

```bash
/context-hub locale            # idioma actual y lista
/context-hub locale es         # cambiar a español
/context-hub locale auto       # seguir el idioma del sistema
```

## Idiomas compatibles

| Código | Idioma | Entradas |
| --- | --- | --- |
| zh | 简体中文 | 257/257 |
| en | English | 257/257 |
| ja | 日本語 | 257/257 |
| ko | 한국어 | 257/257 |
| de | Deutsch | 257/257 |
| fr | Français | 257/257 |
| es | Español | 257/257 |

## Dónde se guarda

- Navegador: `localStorage["context-hub.locale"]`.
- Servidor: tabla `kv` del almacén, clave `config:locale`.
- Verificado por `npm run test:panel-i18n` (7 idiomas × 5 pestañas).

## Solución de problemas

- No cambia: recarga forzada (`Ctrl+Shift+R`) para descartar el JS en caché.
- No aparece el panel: un error de sintaxis impide registrar el bundle; ejecuta `node --check client/client.js`.
- Se pierde tras reiniciar: `config:locale` solo se escribe si el servidor lo soporta; reinicia DSH tras actualizar.

## Relacionado

- [README](README.md)
- [COMPATIBILITY](COMPATIBILITY.md)
- Tablas de palabras: `scripts/locale-data/*.json`
