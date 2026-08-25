#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DICTATION_OUT="${DICTATION_OUT:-$HERE/LocalStudioDictation}"
TITLE_OUT="${TITLE_OUT:-$HERE/LocalStudioTitle}"
HOTKEY_OUT="${HOTKEY_OUT:-$HERE/LocalStudioDictationHotkey}"
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

probe() {
  local out="$1"
  shift
  perl -e 'alarm 30; exec @ARGV' "$out" --probe "$@" 2>/dev/null
}

build "$DICTATION_OUT" LocalStudioDictation.swift
build "$TITLE_OUT" LocalStudioTitle.swift
build "$HOTKEY_OUT" LocalStudioDictationHotkey.swift

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
