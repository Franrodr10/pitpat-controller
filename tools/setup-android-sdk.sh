#!/usr/bin/env bash
# Installs the Android SDK from the command line (no Android Studio): the command-line tools
# plus the packages this project builds with. GitHub Actions uses this same script.
#
#   ./tools/setup-android-sdk.sh [SDK_DIR]     # default: $ANDROID_HOME, or ~/Android/Sdk
#   export ANDROID_HOME=SDK_DIR
#   ./gradlew assembleDebug
#
# Needs curl, unzip and a JDK 17+ (the same one Gradle uses). Linux or macOS; on Windows use WSL.
set -euo pipefail

SDK_DIR="${1:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
REPOSITORY="${ANDROID_REPOSITORY:-https://dl.google.com/android/repository}"
PACKAGES=("platforms;android-37.0" "build-tools;36.0.0" "platform-tools")

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=mac ;;
  *) echo "Sistema no soportado: usa Linux, macOS o WSL." >&2; exit 1 ;;
esac

for tool in curl unzip java; do
  command -v "$tool" >/dev/null || { echo "Falta '$tool'." >&2; exit 1; }
done

bin="$SDK_DIR/cmdline-tools/latest/bin"
if [[ ! -x "$bin/android" && ! -x "$bin/sdkmanager" ]]; then
  # The repository manifest names the current command-line tools archive and its SHA-1.
  entry=$(curl -fsSL "$REPOSITORY/repository2-3.xml" | tr -d '\n' |
    grep -oE "<checksum type=\"sha1\">[0-9a-f]{40}</checksum>[[:space:]]*<url>commandlinetools-$os-[0-9]+_latest\.zip</url>" |
    sort -t- -k3 -V | tail -n 1) || true
  [[ -n "$entry" ]] || { echo "No se encontró la descarga de las command-line tools." >&2; exit 1; }
  sha1=$(sed -E 's/.*<checksum type="sha1">([0-9a-f]{40}).*/\1/' <<<"$entry")
  archive=$(sed -E 's/.*<url>([^<]+)<\/url>.*/\1/' <<<"$entry")

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  echo "Descargando $archive…"
  curl -fsSL -o "$tmp/tools.zip" "$REPOSITORY/$archive"
  actual=$( (command -v sha1sum >/dev/null && sha1sum "$tmp/tools.zip" || shasum -a 1 "$tmp/tools.zip") | cut -d' ' -f1)
  [[ "$actual" == "$sha1" ]] || { echo "Checksum incorrecto en $archive." >&2; exit 1; }
  unzip -q "$tmp/tools.zip" -d "$tmp"
  mkdir -p "$SDK_DIR/cmdline-tools"
  rm -rf "$SDK_DIR/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
fi

if [[ -x "$bin/android" ]]; then
  # Current command-line tools ship the Android CLI, which replaces sdkmanager: package paths use '/'
  # instead of ';' and it accepts the SDK licences itself.
  "$bin/android" --sdk="$SDK_DIR" sdk install --no-metrics "${PACKAGES[@]//;//}"
else
  # Older command-line tools (for example, the ones Android Studio installed) only have sdkmanager.
  (yes 2>/dev/null || true) | "$bin/sdkmanager" --sdk_root="$SDK_DIR" --licenses >/dev/null
  "$bin/sdkmanager" --sdk_root="$SDK_DIR" "${PACKAGES[@]}"
fi
echo "Android SDK listo en $SDK_DIR. Para compilar: export ANDROID_HOME=\"$SDK_DIR\""
