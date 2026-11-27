[Chinese](../../../README.md) · [English](../en/README.md) · [日本語](../ja/README.md) · [한국어](../ko/README.md) · [Deutsch](../de/README.md) · [Français](../fr/README.md) · **Español**

# dsh-context-hub · Context Hub

Un plugin que reúne **compresión, memoria e información** en un solo bundle de DSH: una sola instalación, sin compilación en el host (JavaScript ESM puro), datos en SQLite local.

> Índice de documentación:
> - [docs/spec.md](../../spec.md) — especificación v1.0 (congelada)
> - [docs/design.md](../../design.md) — arquitectura, flujo de datos, contratos DSH, modos de fallo
> - [docs/COMPATIBILITY.md](COMPATIBILITY.md) — matriz de compatibilidad
> - [docs/PANEL-I18N.md](PANEL-I18N.md) — cambio de idioma del panel
> - Texto completo: [inglés](../en/README.md) / [chino](../../../README.md)

## Por qué uno en lugar de tres

En DSH estas tres piezas son tres etapas del mismo pipeline de contexto: la memoria decide *qué pasa a una sesión nueva*, la compresión *qué se descarta y qué se conserva cuando ya no cabe*, y la información *cómo saber si las dos anteriores funcionan bien*. Comparten almacén, canal de inyección (`agent.inject()`) y entrada de búsqueda; separarlas solo duplica trabajo y crea conflictos.

## Capacidades

| Capacidad | Implementación | Entrada |
| --- | --- | --- |
| Memoria | `turn/end` extrae memorias estructuradas con el modelo actual; solo lo que supera el umbral de calidad se escribe en SQLite | automático + `context_hub_remember` |
| Recuperación | Híbrido de palabras clave + trigramas FTS5 (sinónimos, peso por ámbito, decaimiento temporal), opcionalmente coseno vectorial; inyección en el siguiente paso | automático + `context_hub_search` |
| Calidad de recuperación | `context_hub_probe` mide la tasa top-k, `context_hub_explain` detalla las puntuaciones | `context_hub_probe` / `context_hub_explain` |
| Gobernanza | niveles session/project/global, archivo por TTL, expulsión por capacidad, supersede de conflictos | automático |
| Compresión | Reutiliza la compresión nativa de DSH; con `compactor: hub` envuelve `summarize()` (8 secciones, repliegue si falla) | `/context-hub compact` |
| Resúmenes como memorias | Escucha `compaction/summary` y guarda los resúmenes como `kind=summary` | automático |
| Búsqueda/restauración de zonas plegadas | Recorre el registro completo de la sesión y reinyecta el texto original | `context_hub_history` / `context_hub_restore` |
| Despliegue por mensaje | `unfold` sustituye el nodo de resumen por el texto original durante N pasos (solo la petición al modelo) | `context_hub_unfold` |
| Presupuestos estrictos | Tope de tokens (1200) y plazo total (4000 ms) por inyección; si se excede no se inyecta nada | automático |
| Información | Tokens de superficie/total, composición, reserva de salida, marca de agua, zonas plegadas, últimas peticiones, curva de coste | `/context-hub status`, distintivo lateral + panel |
| Auditoría | Borrado suave, reemplazo explícito, cadena de auditoría, registro de observación, exportación JSON | `/context-hub audit/log/export` |
| Relaciones | `memory_links` (related/supersedes), expansión de 1 salto (≤1) | automático + `explain` |
| Índice de mensajes | `messages` + `messages_fts`, indexado incremental; recuperación por texto aun sin memorias | automático |
| Flujo de revisión | Con `reviewPending=true`, las extracciones poco fiables van a pendientes | `/context-hub review` |

## Instalación

```bash
# npm (desde 1.8.0; paquete slim sin dependencias de embed)
# plugin_manager install_bundle(target="dsh-context-hub@1.8.0")

# Tarball de distribución (incluye embed/node_modules; ruta .tgz absoluta)
# plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-<version>.tgz")
```

Tras instalar, el `package.json` del perfil recibe una dependencia y una entrada de bundle, y `cordis.patch.yml` recibe `id: dsh-context-hub`. Recargar tras editar el código (sin reinstalar):

```
plugin_manager set_plugin(target="include:dsh-context-hub", enabled=true)
```

> Nota: `parameters` / `output.schema` de `ctx.tools.register` deben ser JSON Schema estándar (arrays `required: [...]` en objetos). `required: true` por propiedad es el atajo de `defineTool`.

## Verificado

- **1.8.0**: todos los refuerzos P1/P2 (A1/A3/A4/B5/C4/C5/E4/A5/E3/E5/D4/D5), 5 comandos nuevos, exportación/importación JSONL, vistas de memoria, documento de compatibilidad.
- **1.7.x**: compresor del panel native ⇄ hub persistente, errores 409; medición por etapas de recuperación, `rerank.reasoningEffort=low` −30 %.
- **1.6.6**: 100 k memorias + 20 k mensajes: rank p50 85,6 ms / p95 99,8 ms / p99 106,6 ms, base 67 MB, RSS 249 MB.
- **1.6.0**: tope de tokens y plazo, identidad de proyecto git (con migración), despliegue por mensaje.
- **1.5.3**: `multilingual-e5-small` lleva zh-holdout R@5 al 100 %, LongMemEval inglés 12 preguntas 83,3 %.
- Historial anterior en el [README chino](../../../README.md).

## Uso

```
/context-hub status                  # información: presión / zonas plegadas / memoria
/context-hub doctor                  # autodiagnóstico: FTS5/vector/reescritura/reorden
/context-hub search <palabra>        # buscar en la memoria a largo plazo
/context-hub remember <contenido>    # escribir una memoria manualmente
/context-hub history <palabra>       # buscar en todo el registro de sesión
/context-hub restore <seqInicio> [seqFin]  # restaurar texto plegado (4000 caracteres)
/context-hub unfold [id:<n>|seqInicio] [seqFin] [steps:<n>]
/context-hub explain <palabra>       # depuración de recuperación: candidatos y puntuaciones
/context-hub probe [n]               # sonda de tasa de acierto (10 por defecto)
/context-hub log [n]                 # línea de tiempo de eventos
/context-hub audit <id>              # cadena de auditoría
/context-hub forget <id>             # borrado suave
/context-hub supersede <id> <nuevo>  # reemplazo explícito
/context-hub export                  # exportación JSON (0600)
/context-hub compact                 # comprimir ahora
/context-hub compactor <hub|native>  # cambiar compresor
/context-hub reembed                 # recalcular vectores
/context-hub watermark [on|off]      # interruptor de compresión (persistente)
/context-hub config [clave] [valor]
/context-hub review [approve|reject] <id>
/context-hub locale [auto|zh|en|ja|ko|de|fr|es]  # idioma del panel/comandos
```

Panel: tras recargar, aparece abajo a la izquierda un distintivo «anillo + porcentaje de contexto». Al hacer clic se abre una tarjeta de 640 px con cabecera KPI fija y las pestañas **Resumen** (composición, curva de coste, top 5 de actividad), **Memoria** (activas/pendientes/reemplazadas/archivadas/índice, gráficos, recientes, aprobación), **Observación** (detalle, actividad, últimas peticiones), **Config** (presupuesto/TTL/extracción, interruptores semánticos, compresión, compresor, modo, distintivos) e **Idioma**. Esc o clic en el fondo cierra; se actualiza cada 10 s; los colores siguen los tokens de tema de DSH.

![Vista previa del panel](../../panel-preview.png)

Los datos vienen de `/api/context-hub.status` (autenticado por el servicio `connection`; 401 si no). Interruptores: `POST /api/context-hub.watermark`; escrituras: `POST /api/context-hub.review` y `POST /api/context-hub.action`.

Herramientas del modelo: `context_hub_search` / `remember` / `history` / `restore` / `decompress` / `unfold` / `status` / `doctor`, y de solo lectura `explain` / `log` / `probe` / `abtest`.

## Configuración

Los valores por defecto están en `defaults` (`src/index.js`) y pueden sobrescribirse con la config del plugin o variables de entorno. Principales:

| Opción | Defecto | Rango |
| --- | --- | --- |
| `recallMaxItems` | 8 | 1–20 |
| `recallMaxChars` | 1800 | 200–8000 |
| `recallMaxTokens` | 1200 | 100–4000 (tope de tokens por inyección) |
| `recallTimeoutMs` | 4000 | 0–20000 (plazo total; si se agota no se inyecta) |
| `recallCooldownTurns` | 6 | 0–20 |
| `sessionTtlDays` / `projectTtlDays` / `globalTtlDays` | 7 / 90 / 0 | 3·7·15·30 / 0–3650 / 0–3650 |
| `capacityPerScope` | 5000 | 100–100000 |
| `extractPassesPerTurn` | 2 | 1–10 |
| `admissionThreshold` | 0.6 | 0–1 |
| `conflictPolicy` | `evidence` | `evidence` / `recency` |
| `compactor` | `native` | `native` / `hub` |
| `mode` | `auto` | `auto` / `observe` / `assist` / `takeover` / `full` |
| `reviewPending` | false | extracciones poco fiables a pendientes |
| `embedding.enabled` / `baseUrl` / `model` | false / vacío / vacío | endpoint compatible con OpenAI |
| `embedding.fusion` | `weighted` | `weighted` / `rrf` |
| `rewrite.enabled` | false | reescritura de consulta (repliegue) |
| `rerank.enabled` | false | reorden LLM |
| `watermark.enabled` / `triggerRatio` / `retainTokens` | false / 0.7 / 20000 | compresión por marca de agua |
| `unfold.steps` / `maxChars` | 3 / 8000 | presupuesto de despliegue |

Tabla completa en el [README inglés](../en/README.md#configuration). Las entradas instaladas se configuran con `config:` en `cordis.patch.yml` (`insert:` solo en la instalación inicial).

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

### Servicio de embedding local (incluido)

Si no quieres enviar los textos a una API externa, usa el directorio `embed/` incluido (transformers.js + ONNX CPU, compatible con OpenAI). El repositorio incluye `embed/node_modules/` (≈ 475 MB): tras clonar no hace falta `npm install`. Solo el paquete npm (sin dependencias) necesita:

```bash
cd embed && npm install --ignore-scripts
./start.sh                        # inicio manual: 127.0.0.1:11434
curl -s localhost:11434/health    # {"ok":true,...,"ready":true}
```

Si `embedding.baseUrl` apunta a loopback y `embedding.autoStart` es verdadero, el plugin arranca el servicio, consulta `/health` y luego rellena los vectores; un fallo solo degrada. Los modelos están en `embed/.cache/Xenova/<model>/` (descarga en la primera llamada; sin conexión con el activo `dsh-context-hub-models-e5-q8.tar.gz`).

## Distribución y publicación

- `files` de `package.json`: `src` / `client` / `cordis.patch.yml` / `locale` / `icon.svg` / `README.md` / `LICENSE` / `CHANGELOG.md` / `docs` / `scripts` / `test-smoke.mjs` / `embed/`.
- Metadatos de visualización: `locale/en.json` y `locale/zh.json` (`meta.title` / `meta.description`), `icon.svg` (610 B).
- Dos empaquetados: `npm pack` (slim, sin `embed/node_modules`) y `scripts/pack.sh` (`git archive`, con dependencias incluidas, ≈ 157 MB).
- Estado al 2026-11-27: **npm 1.8.0 publicado** (public, slim ≈ 280 kB).
- Distribución: el último `dist/dsh-context-hub-*.tgz` (versión, archivos, bytes y SHA-256 según `dist/INSTALL.md`).

## Datos

- Ruta por defecto: `$DSH_HOME/context-hub/memory.db` (`~/.dsh` si `DSH_HOME` no está definido).
- Sustitución: variable `DSH_CONTEXT_HUB_DB=/path/to/memory.db`.
- La memoria es una **caché derivada**: el registro de sesión es la única verdad; una base corrupta o borrada nunca detiene la sesión.

## Límites de diseño (versión actual)

- No sustituye el servicio de compresión por defecto: con `compactor: native`, `compaction-basic` sigue siendo responsable y el plugin solo dispara e indexa; con `compactor: hub`, envuelve `summarize()` (sin reregistrar, repliegue si falla).
- El panel solo escribe gobernanza, interruptores y presupuestos; el contenido de las memorias no se edita y el contexto es de solo lectura.
- No añade tipos de evento de sesión propios: solo `user/message` y `turn/end`.
- La recuperación combina solapamiento de palabras clave y trigramas FTS5, con coseno vectorial y reescritura LLM opcionales; cualquier indisponibilidad degrada automáticamente.
- La compresión por marca de agua está desactivada por defecto; con `watermark.enabled: true` el pre-step pliega solo el prefijo más antiguo según `triggerRatio` y `retainTokens`/`retainTurns`.
- Los fallos de extracción solo registran `logger.warn` y nunca bloquean la sesión.

## Hoja de ruta

- **1.8.0**: 12 refuerzos P1/P2 (escrituras deterministas, clasificación de conflictos, revisión por niveles, higiene de consultas, recibos de compresión, bucle de calidad, métricas honestas, duplicados cercanos, vistas, JSONL, compatibilidad, portabilidad).
- **1.7.x**: grafo de 1 salto, libro de compresión, compresor del panel, rendimiento.
- **1.6.x**: topes de inyección, identidad git, despliegue por mensaje, distribución vendored.
- **1.5.x**: rediseño del panel, índice de mensajes, embedder multilingüe, retainTurns.
- Después: recuperación semántica en inglés, comportamiento por defecto de la compresión, locale del panel.

Pendiente: calidad de recuperación en inglés (LongMemEval R@5 83,3 %), flujo de aprobación de compresiones grandes; design/spec/comparison solo en chino.
