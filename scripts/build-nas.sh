#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="z-ai"
OUTPUT_FILE="${IMAGE_NAME}-x86_64.tar.gz"

echo "=== Building ${IMAGE_NAME} for linux/amd64 ==="
docker buildx build \
  --platform linux/amd64 \
  -t "${IMAGE_NAME}" \
  --load \
  .

echo ""
echo "=== Exporting to ${OUTPUT_FILE} ==="
docker save "${IMAGE_NAME}" | gzip > "${OUTPUT_FILE}"

echo ""
echo "Done! File: ${OUTPUT_FILE}"
ls -lh "${OUTPUT_FILE}"
