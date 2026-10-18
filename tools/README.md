# Herramientas de prueba del protocolo

Sirven para verificar con la cinta real lo que describe [`docs/PROTOCOL.md`](../docs/PROTOCOL.md) antes de programar la app. Las dos registran lo mismo; usa la que te resulte más cómoda:

| Herramienta | Dónde | Cómo |
|---|---|---|
| [`webbt/index.html`](webbt/index.html) | Chrome en Android (o Chrome/Edge en un ordenador) | se abre como página web |
| [`pitpat_probe.py`](pitpat_probe.py) | PC con Bluetooth (Windows, macOS o Linux) | `pip install bleak` y `python pitpat_probe.py` |

> ⚠️ **La cinta se moverá.** Ten el mando a mano todo el tiempo. Las dos herramientas tienen PARAR siempre disponible (en la página, el botón rojo de abajo; en el script, pulsar Enter sin escribir nada).

## Abrir la página en el móvil

Web Bluetooth necesita que la página se sirva por HTTPS. La forma más sencilla es GitHub Pages:

1. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
2. Al cabo de un minuto, abre en Chrome para Android: <https://franrodr10.github.io/pitpat-controller/tools/webbt/>

La primera vez Chrome pedirá permiso de "Dispositivos cercanos" (o de ubicación en Android 11 o anterior).

## Usar el script en un PC

```bash
pip install bleak
python tools/pitpat_probe.py              # busca la cinta, conecta y abre el modo interactivo
python tools/pitpat_probe.py --selftest   # comprueba el código de tramas sin Bluetooth
```

Escribe `ayuda` para ver los comandos. El registro se guarda en `pitpat_log_<fecha>.txt`.

## Procedimiento de prueba

**Preparación**

- Cinta encendida y en estado normal. Si al pulsar el mando pita de forma larga y molesta, está "bloqueada": ábrela una vez con la app PitPat (o usa la secuencia del mando descrita en el README de pacekeeper).
- Cierra del todo la app PitPat (Ajustes → Aplicaciones → PitPat → Forzar detención): la cinta solo admite una conexión Bluetooth.
- Bluetooth activado. No bloquees el móvil durante la prueba (la página mantiene la pantalla encendida).

Equivalencias en el script: Conectar = arrancar el script, Prueba pasiva = `pasiva`, Arrancar = `a 2`, +0,5 = `+`, Fijar velocidad = `v 3`, Pausa = `p`, PARAR = Enter, Arrancar sin velocidad = `a 0`, Desconectar sin parar = `soltar`, Reconectar = volver a ejecutar el script.

### Paso 1. Conectar (la cinta no se mueve)

Pulsa **Conectar** y elige `PitPat-T01`.

Resultado esperado:

- El indicador pasa a "Conectado".
- En el registro aparecen `SERVICIO 0000fba0-…` con `CARACT. 0000fba1-… [read,write]` y `0000fba2-… [read,notify]`, y `SERVICIO 00001910-…` con `2b10` y `2b11`.
- Empiezan a llegar líneas `<- [52] 68 34 … | OK | parada …` y el panel muestra "parada", el firmware, "máx 6,0 km/h" e "incl. máx 0".

Si en 10 s no llega ninguna línea `<-`, selecciona Heartbeat **"Tras cada trama"** y apúntalo.

### Paso 2. Prueba pasiva (80 s, la cinta no se mueve)

Pulsa **Prueba pasiva (80 s)** y no toques nada.

Resultado esperado: un resumen de tres líneas (`react`, `1s`, `off`) con las tramas por segundo de cada modo. Por lo que cuentan pacekeeper y nicx, espero que la cinta notifique sola (entre 1 y 10 tramas por segundo) y que no se desconecte aunque no se le envíe heartbeat. Si en `off` aparece "SE DESCONECTÓ", pulsa **Reconectar** y haz el resto de pasos con Heartbeat "Tras cada trama".

### Paso 3. Mando físico (la cinta se mueve, la controlas con el mando)

Con la página conectada, usa **solo el mando**: arranca, sube un par de veces, baja hasta el mínimo, pausa y para.

Resultado esperado: el registro muestra `cuenta atrás` → `en marcha`, los cambios de `obj` y `v`, y luego `en pausa` y `parada`. **Apunta la velocidad mínima** que muestra la pantalla de la cinta.

### Paso 4. Comandos desde la página (la cinta se mueve)

1. Velocidad objetivo 2,0 → **Arrancar**. Esperado: `cuenta atrás` unos 3 s y luego `en marcha` a 2,0 km/h.
2. **+0,5**. Esperado: `obj 2.50` y la cinta acelera a 2,5.
3. Escribe 3,0 → **Fijar velocidad**. Esperado: 3,0 km/h.
4. **−0,5** dos veces. Esperado: 2,0 km/h.
5. **Pausa**. Esperado: `en pausa` y la banda se detiene. ¿Se conservan tiempo y distancia?
6. **Arrancar**. Esperado: reanuda. ¿A qué velocidad? ¿Con cuenta atrás?
7. **PARAR**. Esperado: `parada`. ¿Los contadores vuelven a cero?
8. (Opcional) Avanzado → **Arrancar sin velocidad**. Esperado: arranca a su velocidad por defecto (¿cuál?). Después, **PARAR**.

Apunta cualquier comando ignorado, retraso o pitido raro.

### Paso 5. Pérdida de conexión con la cinta en marcha (seguridad)

Arranca a 2,0 km/h, quédate al lado de la cinta y pulsa Avanzado → **Desconectar sin parar**. Observa 30 s: ¿sigue a 2,0, se para sola, pita? Si sigue, párala con el mando. Después pulsa **Reconectar** y mira qué estado informa.

Resultado esperado: no se sabe, es justo lo que hay que averiguar. Decide cómo debe reaccionar la app cuando se pierde la conexión.

### Paso 6. Enviar los resultados

Pulsa **Copiar registro** (o **Descargar**) y pégalo en la conversación, junto con:

- la velocidad mínima que viste en la pantalla,
- qué hizo la cinta en el paso 5,
- si la inclinación se cambia a mano (palanca o patas),
- el modelo de móvil y la versión de Android.

> 🔒 Cada trama incluye el número de serie de la cinta (bytes 32–47). No subas los registros al repositorio ni a issues públicos; el `.gitignore` ya excluye `pitpat_log_*.txt`.

## Alternativa sin instalar nada: nRF Connect

1. Conecta a `PitPat-T01` y, en el menú, pide un MTU de 247 (**Request MTU**).
2. En el servicio `0xFBA0`, activa las notificaciones de `0xFBA2` (icono de tres flechas).
3. Para enviar un comando, pulsa la flecha de escritura de `0xFBA1`, elige **BYTE ARRAY** y pega la trama:

Arrancar a 2,0 km/h:

```text
6A170000000007D001005000040000000DBA9D76EF2643
```

Fijar 3,0 km/h:

```text
6A17000000000BB805005000040000000DBA9D76EF4643
```

Pausa:

```text
6A1700000000000001005000020000000DBA9D76EFF743
```

Parar:

```text
6A1700000000000001005000000000000DBA9D76EFF543
```

Heartbeat:

```text
6A05FDF843
```
