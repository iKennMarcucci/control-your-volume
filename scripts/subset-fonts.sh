#!/usr/bin/env sh
# Regenerates the Latin subsets of Geist shipped with the extension.
# Requires: python3 -m pip install fonttools brotli
set -e
SRC=node_modules/geist/dist/fonts
UNI="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"
python3 -m fontTools.subset "$SRC/geist-sans/Geist-Variable.woff2" --unicodes="$UNI" --flavor=woff2 --layout-features='*' --output-file=src/fonts/geist-sans.woff2
python3 -m fontTools.subset "$SRC/geist-mono/GeistMono-Regular.woff2" --unicodes="U+0020-007E,U+00A0-00FF,U+2026" --flavor=woff2 --output-file=src/fonts/geist-mono.woff2
