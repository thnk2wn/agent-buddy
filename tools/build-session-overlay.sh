#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p daemon/dist/src
xcrun swiftc -O tools/session-overlay.swift -o daemon/dist/src/session-overlay-macos
