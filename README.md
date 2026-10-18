# PitPat Controller

App Android sencilla, rápida y fiable para controlar por Bluetooth Low Energy (BLE) las cintas de andar que usan la app **PitPat** (nombre Bluetooth `PitPat-T01`). Es una alternativa libre a la app oficial: sin cuentas, sin nube y sin publicidad.

> **Estado:** en desarrollo. Ahora mismo se está verificando el protocolo con una cinta real (fase 1). Todavía no hay APK.

## Qué es

- Una app nativa para Android 8.0 o superior (Kotlin + Jetpack Compose) pensada para usarla mientras andas: velocidad en grande, botones grandes y un botón rojo de parada siempre visible.
- Habla directamente con la cinta por BLE, sin pasar por internet.
- La capa de protocolo está separada de la interfaz para poder añadir otras cintas (o el estándar FTMS) en el futuro.

## Cintas compatibles

| Cinta | Nombre BLE | Servicios anunciados | Estado |
|---|---|---|---|
| Caminadora plegable MJWW (AliExpress), 6 km/h, inclinación 6 % | `PitPat-T01` | `0x1910`, `0xFBA0` | En pruebas |

Probablemente funcione con otras cintas que se controlan con la app PitPat y anuncian el servicio `0xFBA0` (por ejemplo Superun BA06-B1 o DeerRun), pero no está probado. Algunas cintas que también se anuncian como `PitPat-T01` usan otra variante del protocolo (características `0xFF01`/`0xFF02`); esas no están soportadas de momento.

## Protocolo y herramientas de prueba

- [`docs/PROTOCOL.md`](docs/PROTOCOL.md): el protocolo BLE de la cinta (UUID, formato de los comandos y de los datos de estado).
- [`tools/`](tools/README.md): una página Web Bluetooth para Chrome en Android y un script Python para el PC con los que probar el protocolo en la cinta, con el procedimiento paso a paso.

## Cómo compilar

> El código de la app llega en la fase 2. Cuando esté, se compilará solo con la línea de comandos, sin Android Studio.

Requisitos: JDK 17 o superior y el Android SDK (command-line tools), con la variable `ANDROID_HOME` apuntando a él (o `sdk.dir` en `local.properties`).

```bash
git clone https://github.com/Franrodr10/pitpat-controller.git
cd pitpat-controller
./gradlew assembleDebug
```

El APK queda en `app/build/outputs/apk/debug/app-debug.apk`.

## Cómo instalar el APK

- **Desde GitHub (recomendado):** abre la página de [Releases](https://github.com/Franrodr10/pitpat-controller/releases) desde el móvil, descarga el `.apk` de la última versión y ábrelo. Android pedirá permiso para instalar apps de origen desconocido (solo la primera vez).
- **Por USB:** con la depuración USB activada en el móvil, ejecuta `adb install -r app-debug.apk`.

## Créditos

El protocolo de estas cintas lo ha descifrado la comunidad. Este proyecto está escrito desde cero y usa estos proyectos solo como referencia para entender el protocolo (no se ha copiado código):

- [peteh/pacekeeper](https://github.com/peteh/pacekeeper): puente ESP32 para la PitPat-T01 (GPL-3.0).
- [KeiranY/PitPat-WebBT](https://github.com/KeiranY/PitPat-WebBT): control por Web Bluetooth en JavaScript (Unlicense).
- [azmke/pitpat-treadmill-control](https://github.com/azmke/pitpat-treadmill-control): control en Python (MIT).
- [cagnulein/qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift), carpeta `src/devices/deeruntreadmill/` (GPL-3.0).
- [nicx/pacekeeper-esphome](https://github.com/nicx/pacekeeper-esphome) y [sirfergy/HomeAssistantWalkingPad](https://github.com/sirfergy/HomeAssistantWalkingPad): derivados de pacekeeper (GPL-3.0).

## Aviso

Proyecto no oficial, sin relación con PitPat ni con los fabricantes de las cintas. Una cinta de andar es una máquina con motor: ten siempre a mano el mando físico y úsala bajo tu responsabilidad.

## Licencia

[MIT](LICENSE)
