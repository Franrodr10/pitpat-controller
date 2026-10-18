# Publicar una versión

Cada tag `v*` (por ejemplo `v0.1.0`) lanza el workflow [`release.yml`](../.github/workflows/release.yml): ejecuta los tests, compila el APK de release y lo publica como **Release** de GitHub, desde donde se descarga directamente en el móvil. Los tags con sufijo (`v0.1.0-beta.1`) se publican como *prerelease*.

## 1. Crear la clave de firma (una sola vez)

Android solo actualiza una app si la nueva versión está firmada con la misma clave, así que esta clave debe ser siempre la misma. Créala en tu ordenador; necesitas un JDK, que incluye `keytool`:

```bash
keytool -genkeypair -v -keystore pitpat-release.jks -alias pitpat \
  -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` pide una contraseña para el almacén y unos datos (nombre, organización…), que pueden ser cualquiera. Si pide también la contraseña de la clave, usa la misma.

> 🔒 **Guarda `pitpat-release.jks` y la contraseña fuera del repositorio**, por ejemplo en tu gestor de contraseñas, y haz una copia de seguridad. Si se pierden, las versiones nuevas no podrán instalarse encima de las anteriores. El `.gitignore` ya excluye `*.jks` y `*.keystore`.

## 2. Guardar la clave en GitHub Secrets

Convierte el almacén a texto Base64:

| Sistema | Comando |
|---|---|
| Linux | `base64 -w0 pitpat-release.jks > keystore.txt` |
| macOS | `base64 -i pitpat-release.jks -o keystore.txt` |
| Windows (PowerShell) | `[Convert]::ToBase64String([IO.File]::ReadAllBytes("pitpat-release.jks")) > keystore.txt` |

En GitHub, en **Settings → Secrets and variables → Actions → New repository secret**, crea estos cuatro secretos:

| Secreto | Valor |
|---|---|
| `SIGNING_KEYSTORE_BASE64` | el contenido de `keystore.txt` |
| `SIGNING_STORE_PASSWORD` | la contraseña del almacén |
| `SIGNING_KEY_ALIAS` | `pitpat` (el alias usado al crearla) |
| `SIGNING_KEY_PASSWORD` | la contraseña de la clave (la misma, si no pusiste otra) |

Después borra `keystore.txt`. Sin estos secretos el workflow sigue funcionando, pero firma con una clave de depuración: sirve para probar, aunque para instalar luego la versión firmada habrá que desinstalar la de prueba.

## 3. Publicar

Sube la versión en `app/build.gradle.kts` (`versionCode` +1 y `versionName`), haz commit y crea el tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

También se puede lanzar desde GitHub: **Actions → Release → Run workflow**, indicando el tag.

## Firmar en local

Para compilar en tu ordenador un APK firmado con la misma clave, añade a `local.properties` (que no se sube al repositorio):

```properties
SIGNING_STORE_FILE=/ruta/a/pitpat-release.jks
SIGNING_STORE_PASSWORD=…
SIGNING_KEY_ALIAS=pitpat
SIGNING_KEY_PASSWORD=…
```

y ejecuta `./gradlew assembleRelease`. El APK queda en `app/build/outputs/apk/release/app-release.apk`.
