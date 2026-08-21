#!/usr/bin/env bash
# Build the on-device dictation helper.
#
# Deliberately plain `swiftc`, not a SwiftPM package: this produces ONE executable with no
# manifest, no .build directory and no resolution step, which is exactly what
# electron-builder's extraResources wants to copy. A package would add ceremony and change
# nothing about the output.
#
#     ./build.sh              build for the host architecture
#     ./build.sh --check      build, then run --probe and fail if the API is unavailable
#
# The deployment target is macOS 26: SpeechAnalyzer / SpeechTranscriber do not exist below it.
# The app itself may target lower — the helper simply will not be spawned there, and
# `dictationAvailable()` on the main-process side is what decides.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${DICTATION_OUT:-$HERE/LocalStudioDictation}"
TARGET_ARCH="${DICTATION_ARCH:-$(uname -m)}"
DEPLOYMENT="${DICTATION_MACOS_MIN:-26.0}"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

case "$TARGET_ARCH" in
  arm64|x86_64) ;;
  *) echo "error: unsupported architecture $TARGET_ARCH" >&2; exit 2 ;;
esac

command -v swiftc >/dev/null 2>&1 || {
  echo "error: swiftc not found. Install Xcode or the Command Line Tools." >&2
  exit 2
}

echo "==> building $OUT for $TARGET_ARCH, macOS $DEPLOYMENT+"
swiftc -O -swift-version 6 \
  -target "${TARGET_ARCH}-apple-macos${DEPLOYMENT}" \
  -o "$OUT" "$HERE/LocalStudioDictation.swift"

chmod +x "$OUT"
echo "==> built $(du -h "$OUT" | cut -f1)"

if [ "$CHECK" = "1" ]; then
  echo "==> probing (no microphone is opened by --probe)"
  # A 30 s ceiling because a hang here is a REPORT, not a hang. The first version of the helper
  # deadlocked before its first line — top-level Swift is @MainActor and a bare `Task { }`
  # blocked on a semaphore never ran — and it presented as an API that "takes a while".
  if ! out=$(DICTATION_PROBE_TIMEOUT=30 perl -e 'alarm 30; exec @ARGV' "$OUT" --probe 2>/dev/null); then
    echo "error: probe failed or timed out" >&2
    exit 1
  fi
  printf '%s\n' "$out" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if not d.get('available'):
    print('error: on-device speech is not available on this machine', file=sys.stderr)
    raise SystemExit(1)
print('    locale       %s  (match: %s)' % (d.get('locale'), d.get('match')))
print('    assetStatus  %s' % d.get('assetStatus'))
print('    supported    %d locales' % len(d.get('supportedLocales') or []))
print('    installed    %s' % ', '.join(d.get('installedLocales') or []))
"
  echo "==> probe OK"
fi
