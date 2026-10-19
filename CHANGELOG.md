# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Cada sección se usa como notas de su Release en GitHub.

## [0.1.0] - 2026-10-19

Primera versión, probada con una caminadora plegable PitPat-T01 (MJWW). Si tienes instalada la 0.1.0-beta.1, desinstálala antes: se firmó con otra clave y Android no deja instalar esta encima.

### Añadido

- Control por Bluetooth LE de las cintas PitPat con servicio `0xFBA0`: arrancar, pausar, reanudar, parar y cambiar de velocidad.
- Pantalla pensada para usar andando: velocidad actual en grande, INICIO/PAUSA y PARAR siempre visibles, ±0,5 km/h y cuatro velocidades rápidas configurables (3, 4, 5 y 6 km/h por defecto).
- Tiempo, distancia, pasos (estimados si la cinta no los envía) y calorías en vivo.
- Conexión automática con la última cinta usada y reconexión si se corta.
- Seguridad: velocidades limitadas a 1,0–6,0 km/h y al máximo de la cinta; PARAR con prioridad, reintentos y comprobación; aviso y vibración si se pierde la conexión; nada se reenvía al reconectar.
- Pantalla siempre encendida durante la sesión, modo oscuro y textos en español.
- Registro de diagnóstico para compartir.
- Documentación del protocolo y herramientas para probarlo (página Web Bluetooth y script Python).

### Limitaciones conocidas

- Si se pierde la conexión, la cinta sigue en marcha a la misma velocidad: hay que pararla con el mando.
- La app debe estar en primer plano: con la pantalla bloqueada o en segundo plano, Android puede cerrarla y cortar la conexión.
