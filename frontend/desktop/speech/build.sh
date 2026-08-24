#!/usr/bin/env bash
# Build the on-device helpers: dictation, and conversation titles.
#
# Deliberately plain `swiftc`, not a SwiftPM package: this produces executables with no
# manifest, no .build directory and no resolution step, which is exactly what
# electron-builder's extraResources wants to copy. A package would add ceremony and change
# nothing about the output.
#
# ONE script for both, not one each. They are the same build in every respect that matters —
# same compiler flags, same architecture, same deployment target, same probe-then-degrade
# contract — and two scripts would be two places to forget to bump the target.
#
#     ./build.sh              build both for the host architecture
#     ./build.sh --check      build, then probe both and fail if either API is unavailable
#
# The deployment target is macOS 26: SpeechAnalyzer / SpeechTranscriber and FoundationModels do
# not exist below it. The app itself may target lower — the helpers simply will not be spawned
# there, and the probes on the main-process side are what decide.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DICTATION_OUT="${DICTATION_OUT:-$HERE/LocalStudioDictation}"
TITLE_OUT="${TITLE_OUT:-$HERE/LocalStudioTitle}"
TARGET_ARCH="${HELPER_ARCH:-${DICTATION_ARCH:-$(uname -m)}}"
DEPLOYMENT="${HELPER_MACOS_MIN:-${DICTATION_MACOS_MIN:-26.0}}"
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

build() {
  local out="$1" source="$2"
  echo "==> building $out for $TARGET_ARCH, macOS $DEPLOYMENT+"
  swiftc -O -swift-version 6 \
    -target "${TARGET_ARCH}-apple-macos${DEPLOYMENT}" \
    -o "$out" "$HERE/$source"
  chmod +x "$out"
  echo "==> built $(du -h "$out" | cut -f1)"
}

# A 30 s ceiling because a hang here is a REPORT, not a hang. The first version of the dictation
# helper deadlocked before its first line — top-level Swift is @MainActor and a bare `Task { }`
# blocked on a semaphore never ran — and it presented as an API that "takes a while".
probe() {
  local out="$1"
  shift
  perl -e 'alarm 30; exec @ARGV' "$out" --probe "$@" 2>/dev/null
}

build "$DICTATION_OUT" LocalStudioDictation.swift
build "$TITLE_OUT" LocalStudioTitle.swift

if [ "$CHECK" = "1" ]; then
  echo "==> probing dictation (no microphone is opened by --probe)"
  if ! out=$(probe "$DICTATION_OUT"); then
    echo "error: dictation probe failed or timed out" >&2
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

  echo "==> probing titles (no session is opened by --probe)"
  if ! out=$(probe "$TITLE_OUT"); then
    echo "error: title probe failed or timed out" >&2
    exit 1
  fi
  # The reason matters more here than it does for speech. `deviceNotEligible`,
  # `appleIntelligenceNotEnabled` and `modelNotReady` are three different conversations with
  # whoever is running this, and only the last one fixes itself by waiting.
  printf '%s\n' "$out" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if not d.get('available'):
    print('error: the on-device model is unavailable (%s)' % d.get('reason'), file=sys.stderr)
    raise SystemExit(1)
print('    locale       %s  (supported: %s)' % (d.get('locale'), d.get('localeSupported')))
"
  echo "==> probes OK"
fi
