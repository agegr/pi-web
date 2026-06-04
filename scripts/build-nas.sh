#!/usr/bin/env bash
set -euo pipefail

DOCKER_USER="zackdk"
IMAGE_NAME="z-ai"
TAG="${DOCKER_USER}/${IMAGE_NAME}:latest"

echo "=== Building ${IMAGE_NAME} for linux/amd64 ==="
docker buildx build \
  --platform linux/amd64 \
  -t "${TAG}" \
  --load \
  .

echo ""
echo "=== Pushing to Docker Hub ==="
docker push "${TAG}"

echo ""
echo "Done! Image pushed: ${TAG}"
echo ""
echo "On NAS, run:"
echo "  docker pull ${TAG}"
echo "  docker run -d --name z-ai -p 30141:30141 ${TAG}"
