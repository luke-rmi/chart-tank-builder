#!/usr/bin/env bash
# Build product images from the source PDFs.
#
# Place the original Chart microbulk PDFs (1000L.pdf, 5500L-MP.pdf, etc.,
# plus options-1-18.pdf) in ./source-pdfs/ and run this script.
#
# Outputs:
#   images/tanks/<tank-id>.webp + .jpg
#   images/options/opt-NN.webp + .jpg
#
# Requires (macOS): brew install poppler imagemagick
set -euo pipefail
cd "$(dirname "$0")"
python3 build_images.py "$@"
