#!/usr/bin/env bash
#
# Fast Swift type-check against the real iOS SDK. macOS only.
#
# WHY THIS EXISTS
#   Until now the iOS half of this package had never been compiled by anything.
#   A full check means generating an Xcode project and running `pod install`,
#   which pulls Yoga, RCT-Folly and glog — minutes of setup for a gate that
#   should take seconds. This type-checks every Swift file in about ten.
#
# WHAT IT VERIFIES
#   - Swift language errors: syntax, type inference, missing overrides,
#     protocol conformance, availability
#   - UIKit, CoreBluetooth, Foundation, UserNotifications and os.log usage,
#     against the GENUINE iOS SDK on the runner. Four of the five files import
#     nothing else, so they are fully checked.
#
# WHAT IT DOES NOT VERIFY
#   - React Native bridge API correctness. Only AirfobModule.swift imports
#     React, and verify/shims/React.swift stands in for it. Those declarations
#     are ours, so they agree with our code by construction.
#   - The Objective-C side: AirfobModule.m and AirfobBootstrap.m are not
#     compiled here, so an RCT_EXTERN_METHOD signature that disagrees with its
#     Swift @objc counterpart will not be caught. That mismatch fails at
#     runtime, not at build time — the example app build is what catches it.
#   - Linking, pod resolution, code signing.
#
# So: necessary, not sufficient. The mirror of android/verify/compile-check.sh.
#
# USAGE
#   bash ios/verify/typecheck.sh

set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "typecheck.sh needs macOS — the iOS SDK is not available on $(uname -s)." >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$HERE/.."
BUILD="$HERE/.verify-build"

DEPLOYMENT_TARGET="13.0"

rm -rf "$BUILD"
mkdir -p "$BUILD"

SDK_PATH="$(xcrun --sdk iphonesimulator --show-sdk-path)"
# Simulator slice: the runner is arm64 on Apple silicon, x86_64 otherwise.
ARCH="$(uname -m)"
[ "$ARCH" = "arm64" ] || ARCH="x86_64"
TARGET="${ARCH}-apple-ios${DEPLOYMENT_TARGET}-simulator"

echo "==> sdk    $(basename "$SDK_PATH")"
echo "==> target $TARGET"

echo "==> React shim"
xcrun swiftc \
  -emit-module \
  -module-name React \
  -target "$TARGET" \
  -sdk "$SDK_PATH" \
  -emit-module-path "$BUILD/React.swiftmodule" \
  "$HERE/shims/React.swift"

echo "==> package sources"
SOURCES=()
while IFS= read -r f; do SOURCES+=("$f"); done < <(find "$IOS_DIR" -maxdepth 1 -name '*.swift' | sort)

if [ ${#SOURCES[@]} -eq 0 ]; then
  echo "no Swift sources found in $IOS_DIR" >&2
  exit 1
fi

for f in "${SOURCES[@]}"; do echo "    $(basename "$f")"; done

# All files in one invocation so cross-file references resolve, exactly as they
# would in a real build.
xcrun swiftc \
  -typecheck \
  -target "$TARGET" \
  -sdk "$SDK_PATH" \
  -I "$BUILD" \
  "${SOURCES[@]}"

echo "==> ok — ${#SOURCES[@]} files type-checked"
