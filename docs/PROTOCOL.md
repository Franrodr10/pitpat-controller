# Protocolo BLE de las cintas PitPat (variante `0xFBA0`, `PitPat-T01`)

Este documento recoge lo que la comunidad ha descubierto del protocolo Bluetooth Low Energy de las cintas que usan la app PitPat, contrastado entre varias implementaciones independientes (ver [Fuentes](#11-fuentes-y-licencias)).

**Estado:** verificado en la práctica con la cinta del autor a través de la app (ver [§10](#10-resultados-con-la-cinta-del-autor)). Leyenda:

- ✅ coincide en todas las referencias que lo tratan.
- ⚠️ hay discrepancias entre referencias o solo lo menciona una.
- ❓ desconocido; se resolverá con las pruebas de [§9](#9-dudas-abiertas-y-cómo-se-resuelven).

## 0. Resumen

| | |
|---|---|
| Servicio | `0000fba0-0000-1000-8000-00805f9b34fb` ✅ |
| Comandos (app → cinta) | característica `0000fba1-…`, escritura con respuesta ✅ |
| Estado (cinta → app) | característica `0000fba2-…`, notificaciones ✅ |
| Trama | `[inicio] [longitud total] [datos…] [checksum] 43`; checksum = XOR de los bytes 1 … n−3 ✅ |
| Enteros | big-endian ✅ |
| Velocidad | milésimas de km/h (`2500` = 2,5 km/h) ✅ |
| Control | un comando de 23 bytes: arrancar / fijar velocidad / pausa / parar ✅ |
| Estado | trama de 52 bytes con velocidad, distancia, pasos, kcal, duración, estado de marcha… ⚠️ |
| Heartbeat | `6A 05 FD F8 43`; la app lo envía cada segundo y funciona ✅; no se ha comprobado si es imprescindible ❓ |
| Inclinación | sin control motorizado en este modelo (a confirmar con el byte 29 del estado) ❓ |
| Pérdida de conexión | la cinta sigue en marcha a la misma velocidad: hay que pararla con el mando ✅ |

## 1. Identificación (advertising)

Advertising de la cinta del autor, capturado con nRF Connect:

| Estructura AD | Tipo | Valor |
|---|---|---|
| `02 01 06` | Flags | LE General Discoverable, sin BR/EDR |
| `03 02 10 19` | Lista incompleta de UUID de 16 bits | `0x1910` |
| `03 02 A0 FB` | Lista incompleta de UUID de 16 bits | `0xFBA0` |
| `09 FF 01 01 xx xx xx xx xx xx` | Manufacturer data | id de fabricante `0x0101` + 6 bytes que parecen la MAC (omitidos) |
| `0B 09 50 69 74 50 61 74 2D 54 30 31` | Nombre completo | `PitPat-T01` |

No anuncia FTMS (`0x1826`): el protocolo es propietario.

Para encontrar la cinta, se filtra por nombre que empiece por `PitPat` **o** por el servicio `0xFBA0` en el advertising. El nombre `PitPat-T01` lo usan varios hardwares distintos (ver [§7](#7-diferencias-entre-referencias)), así que lo que identifica esta variante es el servicio `0xFBA0`.

## 2. Tabla GATT

Volcado de pacekeeper para una "PitPat-T01 – Superun BA06-B1", que anuncia los mismos servicios que la cinta del autor:

| Servicio | Característica | Propiedades | Uso |
|---|---|---|---|
| `0x1800` (GAP) | `0x2A00`, `0x2A01` | read | nombre y apariencia |
| `0x1801` (GATT) | `0x2A05` | indicate | Service Changed |
| `0x1910` (fabricante) | `0x2B10` | read, notify | ❓ sin uso conocido en esta variante |
| | `0x2B11` | read, write, write without response | ❓ qdomyos-zwift escribe aquí un "unlock" (`6B 05 9D 98 43`); las demás referencias no lo usan |
| `0xFBA0` (fabricante) | `0xFBA1` | read, write | **comandos** |
| | `0xFBA2` | read, notify | **estado** |

Los UUID completos siguen la base Bluetooth: `0000xxxx-0000-1000-8000-00805f9b34fb`. Las notificaciones se activan escribiendo `01 00` en el descriptor CCCD (`0x2902`) de `0xFBA2`.

## 3. Formato de trama (común a comandos y estado)

| Offset | Contenido |
|---|---|
| 0 | Byte de inicio: `0x6A` en los comandos ✅; `0x68` en la trama de estado (captura de azmke) ⚠️; `0x6B` en el "unlock" de qdomyos-zwift |
| 1 | Longitud **total** de la trama, incluidos inicio, checksum y fin ✅ |
| 2 … n−3 | Datos |
| n−2 | Checksum: XOR de los bytes 1 … n−3 (incluye el byte de longitud) ✅ |
| n−1 | Fin: `0x43` (`C`) ✅ |

Ejemplo, el heartbeat `6A 05 FD F8 43`: longitud 5, dato `FD`, checksum `05 XOR FD = F8`.

**MTU y fragmentación ❓.** La trama de estado (52 bytes) no cabe en el MTU por defecto de BLE (23, es decir, 20 bytes útiles por notificación). pacekeeper usa NimBLE, que negocia un MTU grande. En Android hay que pedir `requestMtu()` tras conectar y, por robustez, reensamblar las notificaciones usando el byte de longitud. Falta comprobar si con MTU pequeño la cinta fragmenta la trama o la trunca.

## 4. Comandos (app → cinta, `0xFBA1`)

### 4.1 Comando de control (23 bytes)

| Byte | Valor | Significado |
|---|---|---|
| 0 | `6A` | inicio ✅ |
| 1 | `17` | longitud (23) ✅ |
| 2–5 | `00` | reservados ✅ |
| 6–7 | u16 | velocidad objetivo en milésimas de km/h; `0` en pausa y parada ✅ |
| 8 | `01` / `05` | "modo": `01` al arrancar, pausar o parar; `05` al cambiar de velocidad ⚠️ |
| 9 | `00` | inclinación objetivo (no se usa en este modelo) |
| 10 | `50` | peso del usuario en kg (80) ⚠️ |
| 11 | `00` | reservado |
| 12 | op | bits 0–2: `04` = arrancar/fijar velocidad, `02` = pausa, `00` = parar ✅; bit 3 (`08`) = unidades imperiales, a 0 para km/h ⚠️ |
| 13–20 | u64 | id de usuario; todas las referencias de esta variante usan `58965456623` = `00 00 00 0D BA 9D 76 EF` y no parece validarse ⚠️ |
| 21 | XOR | checksum de los bytes 1 … 20 ✅ |
| 22 | `43` | fin ✅ |

Ejemplos (peso 80 kg, id de usuario por defecto):

| Acción | Trama |
|---|---|
| Arrancar a 1,0 km/h | `6A 17 00 00 00 00 03 E8 01 00 50 00 04 00 00 00 0D BA 9D 76 EF 1A 43` |
| Arrancar a 2,0 km/h | `6A 17 00 00 00 00 07 D0 01 00 50 00 04 00 00 00 0D BA 9D 76 EF 26 43` |
| Arrancar sin velocidad (variante de pacekeeper) | `6A 17 00 00 00 00 00 00 01 00 50 00 04 00 00 00 0D BA 9D 76 EF F1 43` |
| Fijar 3,0 km/h | `6A 17 00 00 00 00 0B B8 05 00 50 00 04 00 00 00 0D BA 9D 76 EF 46 43` |
| Fijar 4,5 km/h | `6A 17 00 00 00 00 11 94 05 00 50 00 04 00 00 00 0D BA 9D 76 EF 70 43` |
| Fijar 6,0 km/h | `6A 17 00 00 00 00 17 70 05 00 50 00 04 00 00 00 0D BA 9D 76 EF 92 43` |
| Pausa | `6A 17 00 00 00 00 00 00 01 00 50 00 02 00 00 00 0D BA 9D 76 EF F7 43` |
| Parar | `6A 17 00 00 00 00 00 00 01 00 50 00 00 00 00 00 0D BA 9D 76 EF F5 43` |

### 4.2 Semántica

- **Arrancar:** op `04` con modo `01`. La cinta hace una cuenta atrás (estado `0x18`, unos 3 s) y luego se pone en marcha. PitPat-WebBT envía la velocidad deseada en este comando; pacekeeper envía 0 y la cinta usa su velocidad por defecto ❓.
- **Fijar velocidad:** el mismo op `04`, con modo `05` y la nueva velocidad. ❓ No se sabe si este comando arrancaría la cinta estando parada; la app nunca lo enviará fuera del estado "en marcha".
- **Pausa:** op `02`. La cinta se detiene conservando los contadores; volver a arrancar la reanuda ❓.
- **Parar:** op `00`. Termina la sesión ❓ (¿se ponen a cero los contadores?).
- **Límites:** la velocidad máxima viene en la trama de estado (bytes 27–28: `6000` = 6,0 km/h). La mínima parece ser 1,0 km/h (deslizador de PitPat-WebBT) ❓. Según sirfergy, la cinta para con cualquier velocidad ≤ 0,1 km/h; la app nunca envía velocidades fuera de [mínima, 6,0].

### 4.3 Heartbeat ❓

`6A 05 FD F8 43` (op `FD`, sin datos).

- PitPat-WebBT y azmke lo envían tras **cada** notificación y aprovechan ese turno para mandar el comando pendiente en su lugar.
- qdomyos-zwift lo envía cada 200 ms y espera la notificación de respuesta.
- pacekeeper, sirfergy y nicx **no** lo envían nunca y funcionan. nicx indica que pedir un intervalo de conexión de 15–30 ms con un timeout de supervisión de 6 s evita una desconexión a los ~30 s de inactividad.

Hay que verificar si la cinta notifica por sí sola, a qué ritmo, y si la conexión se cae sin heartbeat.

### 4.4 Otras tramas vistas (no necesarias según las referencias de esta variante)

| Trama | Dónde | Notas |
|---|---|---|
| `6A 05 D7 D2 43` | `0xFBA1` | "init 2" de qdomyos-zwift, significado desconocido |
| `6B 05 9D 98 43` | `0x2B11` | "unlock" de qdomyos-zwift |
| `6A 17 … 05 00 81 … 93 43` (25 bytes) | `0xFBA1` | "start" de qdomyos-zwift; la longitud declarada (23) no coincide con la real, probablemente es un error de captura |

Solo se probarán si los comandos básicos no funcionan.

## 5. Estado (cinta → app, notificaciones de `0xFBA2`)

La mayoría de referencias exigen al menos 31 bytes para interpretar la trama (qdomyos-zwift, 50); la captura publicada por azmke mide 52.

| Byte | Tipo | Campo | Notas |
|---|---|---|---|
| 0 | u8 | inicio | `0x68` en la captura de azmke ⚠️ |
| 1 | u8 | longitud total | `0x34` = 52 |
| 2 | u8 | ❓ | |
| 3–4 | u16 | velocidad actual (milésimas de km/h) | ✅ |
| 5–6 | u16 | velocidad objetivo | ✅ |
| 7–10 | u32 | distancia en metros | ✅ |
| 11 | u8 | inclinación actual | |
| 12 | u8 | inclinación objetivo; según azmke los bits 6–7 son el estado andar/correr | ⚠️ |
| 13 | u8 | pulso (bpm) | |
| 14–17 | u32 | pasos | ⚠️ según nicx, el firmware del BA06-B1 siempre envía 0 |
| 18–19 | u16 | kcal | ✅ |
| 20–23 | u32 | duración: ms si el firmware es > 19, segundos si no | ⚠️ (regla de azmke) |
| 24 | u8 | id de ciclo / sesión | |
| 25 | u8 | versión de firmware | |
| 26 | u8 | flags (tabla siguiente) | ✅ |
| 27–28 | u16 | velocidad máxima (milésimas de km/h) | ✅ |
| 29 | u8 | inclinación máxima; 0 = sin inclinación motorizada | |
| 30 | u8 | tipo de dispositivo (bits 0–4) | |
| 31 | u8 | ❓ (relacionado con la pulsera según azmke) | |
| 32–47 | ASCII | número de serie (16 caracteres) | dato identificativo: no publicarlo |
| 48 | u8 | modelo BLE | |
| 49 | u8 | marca BLE | |
| 50 | u8 | checksum (XOR de los bytes 1 … 49) | ✅ |
| 51 | u8 | `0x43` | ✅ |

**Flags (byte 26):**

| Bits | Máscara | Significado |
|---|---|---|
| 0 | `0x01` | ¿Wi-Fi conectada? |
| 1–2 | `0x06` | ❓ |
| 3–4 | `0x18` | estado de marcha: `0x18` cuenta atrás, `0x08` en marcha, `0x10` en pausa, `0x00` parada ✅ |
| 5–6 | `0x60` | pulsera: distinto de `0x60` = hay pulsera |
| 7 | `0x80` | unidades imperiales en la pantalla; según sirfergy, por BLE los valores son siempre métricos |

**Ejemplo** (trama sintética con un número de serie inventado): en marcha a 3,5 km/h, 1,234 km, 1520 pasos, 56 kcal, 754 s, firmware 27, máximo 6,0 km/h:

```
68 34 00 0D AC 0D AC 00 00 04 D2 00 00 00 00 00 05 F0 00 38 00 0B 81 50
2A 1B 08 17 70 00 05 00 45 58 41 4D 50 4C 45 2D 53 45 52 49 41 4C 30 30
00 00 CB 43
```

## 6. Secuencia típica

1. Escanear (nombre `PitPat*` o servicio `0xFBA0`) y conectar.
2. Pedir un MTU grande (Android: `requestMtu(517)`) y descubrir servicios.
3. Activar notificaciones en `0xFBA2`.
4. La cinta empieza a notificar su estado (frecuencia ❓). Heartbeat si hace falta ❓.
5. Arrancar → estado `0x18` (cuenta atrás) → `0x08` (en marcha).
6. Fijar velocidad (modo `05`) mientras está en marcha.
7. Pausa (`0x10`) y reanudar con arrancar.
8. Parar (`0x00`).

## 7. Diferencias entre referencias

| Proyecto | Licencia | Cinta | Servicio / características | Trama | Heartbeat | Arrancar |
|---|---|---|---|---|---|---|
| [pacekeeper](https://github.com/peteh/pacekeeper) | GPL-3.0 | PitPat-T01 (Superun BA06-B1) | `FBA0`: `FBA1` / `FBA2` | directa | no | op 4, velocidad 0 |
| [PitPat-WebBT](https://github.com/KeiranY/PitPat-WebBT) | Unlicense | PitPat (según pacekeeper, también la B1) | `FBA0`: `FBA1` / `FBA2` | directa | tras cada notificación | op 4 con la velocidad deseada |
| [pitpat-treadmill-control](https://github.com/azmke/pitpat-treadmill-control) | MIT | "Pitpat T01 (BA04)" | `FF01` / `FF02` | con cabecera `4D 00 <contador> <longitud>` | tras cada notificación (con contador) | op 4, 1,0 km/h |
| [qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift) (`deeruntreadmill`) | GPL-3.0 | DeerRun / Superun / PitPat | detecta 3 variantes: `FBA0` (directa), `0xFFFF` con `FF01`/`FF02` y `FFF0` con `FFF1`/`FFF2` (las dos últimas con cabecera `4D 00`) | ambas | cada 200 ms | secuencia de inicio propia |
| [HomeAssistantWalkingPad](https://github.com/sirfergy/HomeAssistantWalkingPad), [pacekeeper-esphome](https://github.com/nicx/pacekeeper-esphome) | GPL-3.0 | BA06-B1 | `FBA0`: `FBA1` / `FBA2` | directa | no | op 4, velocidad 0 |

Otras diferencias del comando de control:

- **Byte 8:** azmke/WebBT ponen `05` solo al fijar velocidad; pacekeeper pone `05` siempre que la velocidad no es 0; qdomyos-zwift usa `01` al fijar velocidad y `05` al parar.
- **Bytes 10 y 13–20 (peso e id):** qdomyos-zwift usa otros valores (100 o 138 kg, otros ids) sin que parezca importar.
- **Byte 12:** qdomyos-zwift envía `0x0C` (op 4 con el bit 3 activo) para fijar velocidad y `0x02` (pausa) como "parar".
- **Cabecera `4D 00`:** solo en las variantes `FF01`/`FF02` y `FFF1`/`FFF2`. El contenido interno es el mismo protocolo `6A … 43`.

**Conclusión:** la cinta del autor anuncia `0x1910` y `0xFBA0`, exactamente los servicios de fabricante del volcado GATT de pacekeeper (BA06-B1). Encaja con la variante **`FBA0` con tramas directas, sin cabecera `4D 00`**, la de pacekeeper, PitPat-WebBT, sirfergy y nicx. El transporte de azmke (`FF01`/`FF02` con cabecera) no aplica, aunque el contenido de sus tramas (comando de 23 bytes y trama de estado) sea el mismo.

## 8. Inclinación

El protocolo tiene campos de inclinación (byte 9 del comando; bytes 11, 12 y 29 del estado), pero en este modelo la inclinación del 6 % es mecánica. Si el byte 29 (inclinación máxima) vale 0, la app no implementará control de inclinación.

## 9. Dudas abiertas y cómo se resuelven

Las herramientas de [`tools/`](../tools/README.md) registran todo lo necesario para resolverlas:

1. ¿La cinta notifica sola sin heartbeat? ¿Con qué frecuencia? ¿Cambia con heartbeat? → prueba pasiva.
2. ¿Se cae la conexión sin heartbeat (pasados ~30 s)? → prueba pasiva.
3. ¿Llegan las tramas completas o fragmentadas? ¿Miden 52 bytes y empiezan por `0x68`? → registro.
4. ¿Arrancar con velocidad arranca a esa velocidad o a la de por defecto? → arrancar a 2,0 km/h.
5. ¿Fijar velocidad (modo `05`) funciona en marcha, con pasos de 0,1 km/h? → `+`, `−` y velocidad libre.
6. ¿Cuál es la velocidad mínima real? → mando físico.
7. ¿Pausa y reanudar conservan los contadores? ¿Parar los pone a cero? → pausa, arrancar, parar.
8. ¿En qué unidad viene la duración? ¿Qué firmware tiene la cinta? → registro.
9. ¿Los pasos son siempre 0? ¿Las kcal tienen sentido? → registro en marcha.
10. ¿La inclinación máxima (byte 29) es 0? → registro.
11. ¿Qué hace la cinta si se pierde la conexión mientras está en marcha? → prueba de desconexión.
12. ¿Los cambios hechos con el mando físico aparecen en las notificaciones? → mando físico.
13. Solo si los comandos no funcionan: ¿hace falta el "unlock" de `0x2B11`?

## 10. Resultados con la cinta del autor

Caminadora plegable MJWW (`PitPat-T01`, servicios `0x1910` y `0xFBA0`), probada con PitPat Controller 0.1.0-beta.1:

- ✅ La variante `FBA0` con tramas directas es la correcta: la app conecta, recibe el estado y la cinta obedece a arrancar, cambiar de velocidad, pausar, reanudar y parar.
- ✅ La app funciona con el heartbeat activado (una trama `6A 05 FD F8 43` por segundo), que es su configuración por defecto.
- ⚠️ **Si se pierde la conexión con la cinta en marcha, la cinta sigue andando a la misma velocidad.** No hay parada de seguridad por pérdida de enlace: hay que pararla con el mando. Por eso la app avisa con un mensaje y vibración cuando se corta.

Siguen sin medir: si el heartbeat es imprescindible, la velocidad mínima real (la app usa 1,0 km/h) y si este firmware informa de los pasos (si envía 0, la app los estima).

## 11. Fuentes y licencias

El código de este repositorio está escrito desde cero (licencia MIT). Estos proyectos se han consultado solo para entender el protocolo:

- peteh/pacekeeper (GPL-3.0): tabla GATT, comando y parseo del estado para PitPat-T01.
- KeiranY/PitPat-WebBT (Unlicense): heartbeat y comandos por Web Bluetooth.
- azmke/pitpat-treadmill-control (MIT): significado de la mayoría de campos de la trama de estado.
- cagnulein/qdomyos-zwift, `src/devices/deeruntreadmill/` (GPL-3.0): variantes, secuencia de inicio y unlock.
- sirfergy/HomeAssistantWalkingPad y nicx/pacekeeper-esphome (GPL-3.0): unidades, umbral de parada, pasos a 0 y parámetros de conexión.
