[Chinese](../../../UPGRADE-GUIDE.md) · [English](../en/UPGRADE-GUIDE.md) · [日本語](../ja/UPGRADE-GUIDE.md) · [한국어](../ko/UPGRADE-GUIDE.md) · [Deutsch](../de/UPGRADE-GUIDE.md) · [Français](../fr/UPGRADE-GUIDE.md) · **Español**

# Guía de actualización (→ 1.8.0)

> Se aplica al pasar de cualquier 1.x a 1.8.0.

## 🚀 Actualización rápida

```bash
# tarball de distribución (con dependencias)
plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-1.8.0.tgz")
dsh restart
```

Con npm: `npm install dsh-context-hub@1.8.0` y luego reiniciar DSH.

## 📋 Comprobaciones previas

- Copia de seguridad de la memoria: `cp ~/.dsh/context-hub/memory.db{,.bak}`.
- Comprobar Node.js ≥ 22.13 y DSH 0.2.x.
- Anotar la versión actual: `/context-hub status`.

## ✨ Guía de nuevas funciones

- **Señales explícitas de memoria**: «recuerda», «no», «prefiero», «pendiente» se escriben de inmediato sin llamar al LLM.
- **Detección de conflictos**: negaciones, cambios numéricos y transiciones de estado se detectan y enlazan con supersede.
- **Vistas de memoria**: `/context-hub graph <id>`, `/context-hub timeline [scope]`, `/context-hub conflicts <id>`.
- **Exportación/importación JSONL**: `/context-hub export-jsonl` e `import-jsonl <ruta>` (idempotente por hash).
- **Idioma**: `/context-hub locale [auto|zh|en|ja|ko|de|fr|es]`, también en el panel.

## 🔧 Cambios de configuración

Nuevas opciones: `reviewPolicy` (`off` / `low-confidence` / `layered`), `locale` (`auto` o código de idioma). Las existentes mantienen sus valores por defecto; no es necesario cambiar nada.

```yaml
- id: dsh-context-hub
  config:
    reviewPolicy: layered
    locale: auto
```

## 🐛 Solución de problemas

- No aparece el panel tras actualizar → recarga forzada; si persiste, `node --check client/client.js`.
- El idioma no cambia → reinicia DSH (recarga el plugin del servidor) y refresca la página.
- Memoria no disponible → revisa permisos de `$DSH_HOME/context-hub/memory.db`; la sesión sigue sin memoria.

## 📊 Impacto en rendimiento

| Operación | Latencia añadida |
| --- | --- |
| Escritura de señal explícita | ~0 ms |
| Detección de conflicto | +50–200 ms |
| Revisión por niveles (LLM) | +200–500 ms |
| Generación de grafo | +500–2000 ms |

La recuperación vectorial mantiene su huella (opcional, desactivada por defecto).

## 🆚 Comparación de versiones

| Función | 1.7.x | 1.8.0 |
| --- | --- | --- |
| Señales explícitas | ❌ | ✅ |
| Detección de conflictos | ❌ | ✅ |
| Grafo / línea de tiempo / conflictos | ❌ | ✅ |
| Exportación/importación JSONL | ❌ | ✅ |
| Métricas honestas | ❌ | ✅ |
| Idiomas del panel | ❌ | ✅ 7 idiomas |

## 📞 Ayuda

- Salida de `dsh context-hub doctor`
- Versiones de DSH y Node.js, SO
- Registros: `tail -n 50 ~/.dsh/logs/context-hub.log`
- Issues: https://github.com/ElementBen555/context-hub/issues

## 🎉 Listo

Verificar tras actualizar:

```bash
/context-hub status
/context-hub doctor
/context-hub probe
/context-hub locale
```
