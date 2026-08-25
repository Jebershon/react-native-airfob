#!/usr/bin/env bash
#
# Fast Kotlin compile check — no Android SDK, no Gradle, no emulator.
#
# WHY THIS EXISTS
#   A full Android build needs the SDK (~1 GB) plus a matching JDK and AGP. That
#   is the right check before shipping, but it is too slow and too heavy to run
#   on every change, and it means native code sits uncompiled for days at a time.
#   This compiles the Kotlin in about 30 seconds on any machine with a JDK.
#
# WHAT IT VERIFIES
#   - Kotlin language errors: syntax, type inference, missing overrides,
#     visibility, unreachable returns
#   - React Native bridge API usage — compiled against the REAL react-android
#     classes pulled from Maven Central, not against anything we wrote
#   - androidx.core and androidx.startup usage, also real artifacts
#
# WHAT IT DOES NOT VERIFY
#   - Android framework API correctness. android.jar ships only inside the SDK,
#     so the classes under stubs/ are hand-written to match what this package
#     uses. If a framework signature is wrong there, it is wrong here too and
#     this check will not catch it. Only a real Gradle build will.
#   - Resource processing, manifest merging, R8, or anything AGP does.
#
# So: necessary, not sufficient. Run a real Gradle build before shipping.
#
# USAGE
#   bash android/verify/compile-check.sh
#
# Requires a JDK 17 or 21 on PATH (or JAVA_HOME set) and network access on the
# first run to fetch the compiler and jars into .verify-cache/.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$HERE/.verify-cache"
SRC="$HERE/../src/main/java/com/airfob"

KOTLIN_VERSION="1.9.24"
RN_VERSION="0.73.0"

mkdir -p "$CACHE/libs"

fetch() {
  local url="$1" out="$2"
  [ -f "$out" ] && return 0
  echo "  fetching $(basename "$out")"
  curl -sS -L -o "$out" "$url"
}

echo "==> dependencies"
fetch "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" "$CACHE/kotlinc.zip"
fetch "https://repo1.maven.org/maven2/com/facebook/react/react-android/${RN_VERSION}/react-android-${RN_VERSION}-release.aar" "$CACHE/libs/react-android.aar"
fetch "https://maven.google.com/androidx/core/core/1.12.0/core-1.12.0.aar" "$CACHE/libs/core.aar"
fetch "https://maven.google.com/androidx/annotation/annotation/1.7.0/annotation-1.7.0.jar" "$CACHE/libs/annotation.jar"
fetch "https://maven.google.com/androidx/startup/startup-runtime/1.1.1/startup-runtime-1.1.1.aar" "$CACHE/libs/startup.aar"
fetch "https://repo1.maven.org/maven2/org/json/json/20231013/json-20231013.jar" "$CACHE/libs/json.jar"

[ -d "$CACHE/kotlinc" ] || unzip -q -o "$CACHE/kotlinc.zip" -d "$CACHE"

for aar in react-android core startup; do
  jar="$CACHE/libs/${aar}-classes.jar"
  [ -f "$jar" ] && continue
  rm -rf "$CACHE/libs/x_$aar" && mkdir -p "$CACHE/libs/x_$aar"
  (cd "$CACHE/libs/x_$aar" && unzip -q -o "../${aar}.aar")
  cp "$CACHE/libs/x_$aar/classes.jar" "$jar"
done

# javac and kotlinc.bat are native Windows programs. Under Git Bash they get
# POSIX paths (/d/...) which they cannot resolve, so translate on the way out.
# Mixed mode (-m) not Windows mode (-w): kotlinc argfiles treat backslash as an
# escape character and silently eat it, so D:/a/b survives where D:a does not.
# No-op everywhere else.
winpath() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# Classpath separator: Windows uses ;, everything else :
if command -v cygpath >/dev/null 2>&1; then SEP=";"; else SEP=":"; fi

echo "==> android stubs"
rm -rf "$CACHE/stub-classes" && mkdir -p "$CACHE/stub-classes"
STUB_SOURCES=()
while IFS= read -r f; do STUB_SOURCES+=("$(winpath "$f")"); done < <(find "$HERE/stubs" -name '*.java')
javac -nowarn -d "$(winpath "$CACHE/stub-classes")" "${STUB_SOURCES[@]}"

echo "==> kotlin"
# kotlinc.bat splits arguments on ';' under Windows batch, so the classpath has
# to arrive via an argfile rather than on the command line.
CP="$(winpath "$CACHE/stub-classes")"
for jar in react-android-classes core-classes startup-classes annotation json; do
  CP="${CP}${SEP}$(winpath "$CACHE/libs/$jar.jar")"
done

cat > "$CACHE/args.txt" <<ARGS
-nowarn
-classpath "$CP"
-d "$(winpath "$CACHE/out")"
"$(winpath "$SRC")"
ARGS

rm -rf "$CACHE/out"
if [ -x "$CACHE/kotlinc/bin/kotlinc" ] && [ "${OS:-}" != "Windows_NT" ]; then
  "$CACHE/kotlinc/bin/kotlinc" "@$CACHE/args.txt"
else
  "$CACHE/kotlinc/bin/kotlinc.bat" "@$CACHE/args.txt"
fi

echo "==> ok — $(find "$CACHE/out" -name '*.class' | wc -l | tr -d ' ') classes"
