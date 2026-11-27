[Chinese](../../../COMPATIBILITY.md) · [English](../en/COMPATIBILITY.md) · [日本語](../ja/COMPATIBILITY.md) · [한국어](../ko/COMPATIBILITY.md) · [Deutsch](../de/COMPATIBILITY.md) · [Français](../fr/COMPATIBILITY.md) · **Español**

# Compatibilidad y matriz de entorno

> Versión: 2026-11-27 · corresponde a la implementación **1.8.1**
> Objetivo: indicar qué versiones de DSH, Node.js y sistema operativo se admiten y qué degrada con elegancia.

## 1. Dependencias principales

| Dependencia | Mínimo | Recomendado | Nota |
| --- | --- | --- | --- |
| DSH | 0.2.0 | último 0.2.x | usa `cordis` y el servicio `compaction` |
| Node.js | 22.13.0 | 22.x o 24.x LTS | requiere `node:sqlite` y ESM |
| npm | 10.0 | 10.x / 11.x | solo para instalar dependencias |

## 2. Formas de instalación

- **npm**: `npm install dsh-context-hub@<version>` (paquete slim, sin `embed/node_modules`).
- **Código fuente**: `git clone` + `npm install` (Node ≥22.13).
- **Tarball sin conexión**: la salida de `scripts/pack.sh` incluye `embed/node_modules`, sin instalación adicional.

## 3. Sistemas operativos

| SO | Estado | Nota |
| --- | --- | --- |
| Linux x64 | ✅ totalmente compatible | binarios onnxruntime y sharp incluidos |
| Linux arm64 | ✅ compatible | onnxruntime arm64 incluido, sharp no |
| macOS arm64 | ⚠️ parcial | onnxruntime presente, sin darwin x64, sin sharp |
| Windows x64 | ⚠️ parcial | onnxruntime presente, sin sharp |

El plugin es JavaScript puro y funciona donde funcione DSH; solo el servicio vectorial local opcional depende de binarios nativos.

## 4. Compatibilidad con DSH

| DSH | Estado |
| --- | --- |
| 0.2.x | ✅ compatible (objetivo principal) |
| < 0.2.0 | ❌ no compatible (sin API `compaction`) |

## 5. Compatibilidad con Node.js

| Node.js | Estado |
| --- | --- |
| 22.13+ | ✅ mínimo requerido (`node:sqlite` estable) |
| 24.x | ✅ probado |

## 6. Dependencias de funciones opcionales

| Función | Requisito |
| --- | --- |
| Recuperación vectorial | endpoint `/embeddings` compatible con OpenAI, o el `embed/` incluido |
| Reescritura de consulta / reorden | una ruta de modelo disponible para el agente |
| Resúmenes de compresión | servicio `compaction` de DSH (nativo) |

## 7. Limitaciones conocidas

- El paquete npm es slim; los vectores locales requieren `cd embed && npm install --ignore-scripts`.
- El `sharp` incluido solo existe para Linux x64; macOS/Windows deben instalar sus dependencias.
- `npm pack` excluye `node_modules`; usa `scripts/pack.sh` para paquetes con dependencias.
- La recuperación semántica en inglés (LongMemEval R@5 83,3 %) iguala al léxico, no lo supera.

## 8. Ruta de actualización

1. Copia de seguridad de la memoria (`cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.bak`).
2. Sustituir el plugin (`plugin_manager install_bundle` o `npm install`).
3. Reiniciar DSH para recargar el plugin del servidor.
4. Verificar con `/context-hub doctor`.

Los cambios de esquema son aditivos; no se necesita migración.

## 9. Solución de problemas

- **401 en `/api/context-hub.status`**: ruta registrada pero petición sin autenticar; el panel consulta desde una página autenticada.
- **No aparece el panel**: error de sintaxis del bundle; ejecuta `node --check client/client.js`.
- **`FTS5 unavailable`**: actualiza SQLite; la recuperación degrada a palabras clave.
- **Servicio vectorial no listo**: revisa `embed/embed.log` y `curl localhost:11434/health`.

## 10. Cobertura de pruebas

- `node test-smoke.mjs` — extremo a extremo del servidor.
- `npm run test:panel-i18n` — 7 idiomas × 5 pestañas.
- `npm run check:locales` — tablas de palabras sincronizadas con el cliente.
- `node scripts/docs-i18n-check.mjs` — localización de la documentación.
- `node scripts/stress.mjs` / `scripts/concurrency.mjs` — escala y concurrencia.

## 11. Registro de cambios

Ver [CHANGELOG.md](../../../CHANGELOG.md) y [RELEASE-1.8.0.md](../../../RELEASE-1.8.0.md).

## 12. Alcance del soporte

Soporte comunitario por GitHub Issues, sin SLA. Adjunta la salida de `doctor`, versiones de DSH/Node.js y sistema operativo.

## 13. Comentarios

Abre un issue en https://github.com/ElementBen555/context-hub/issues con pasos de reproducción y registros.
