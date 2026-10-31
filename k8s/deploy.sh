#!/usr/bin/env bash
# Deploy the MOCK-ONLY build to the SE cluster. The first deploy of each app is OWNER-APPROVED: this script refuses to
# run unless OWNER_APPROVED=1 is set by the owner. It never builds or pushes an image; it applies manifests for an image
# that already exists in the registry.
#
#   OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=<registry>/<repo>/session-lab:<sha> SE_HOST=<host> k8s/deploy.sh [--dry-run]
#
# Manifests carry the literal tokens __IMAGE__ and __SE_HOST__; this script renders them with sed and fails if any __TOKEN__ is left.
# NAMESPACE has no default (which namespace SE uses is the owner's decision). The ingress class and TLS issuer are NOT set here:
# the owner adds them for the cluster after review (UNVERIFIED which ones SE uses).
#
# After the deploy (not done by this script): verify by CONTENT, not 200 (GET /api/info must say {mode:mock, simulated:true, hosted:true}),
# check the registry manifest and the pod's imageID match IMAGE, and hand over the full https:// URL after browser proof.
set -euo pipefail
cd "$(dirname "$0")"

case "${1:-}" in ""|--dry-run) ;; *) echo "refusing: unknown argument (only --dry-run)" >&2; exit 2;; esac
[ "${OWNER_APPROVED:-}" = "1" ] || { echo "refusing: the first SE deploy of each app is owner-approved (set OWNER_APPROVED=1)" >&2; exit 2; }
for v in NAMESPACE IMAGE SE_HOST; do [ -n "${!v:-}" ] || { echo "refusing: set $v (see the usage line)" >&2; exit 2; }; done
case "$IMAGE" in
  *:latest|*:HEAD|*:|*[!A-Za-z0-9._:/@-]*|"") echo "refusing: IMAGE must carry an explicit immutable tag or digest, not latest/HEAD" >&2; exit 2;;
  *:*) ;;
  *) echo "refusing: IMAGE has no tag" >&2; exit 2;;
esac
printf '%s' "$IMAGE" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/-]*(:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}|@sha256:[a-f0-9]{64})$' || { echo "refusing: IMAGE must look like repo/name:tag or repo/name@sha256:<64 hex>" >&2; exit 2; }
case "$IMAGE" in *__*) echo "refusing: IMAGE must not contain a __TOKEN__" >&2; exit 2;; esac
printf '%s' "$SE_HOST" | grep -Eq '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$' || { echo "refusing: SE_HOST must be a plain host name" >&2; exit 2; }
printf '%s' "$NAMESPACE" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' || { echo "refusing: NAMESPACE must be a plain name" >&2; exit 2; }

render() {
  local out
  out="$(sed -e "s|__IMAGE__|$IMAGE|g" -e "s|__SE_HOST__|$SE_HOST|g" "$1")"
  if printf '%s\n' "$out" | grep -Eq '__[A-Z_]+__'; then echo "refusing: unreplaced __TOKEN__ left in $1" >&2; exit 2; fi
  printf '%s\n---\n' "$out"
}
if [ "${1:-}" = "--dry-run" ]; then render deployment.yaml; render service.yaml; render ingress.yaml; exit 0; fi
for f in deployment.yaml service.yaml ingress.yaml; do render "$f" | kubectl -n "$NAMESPACE" apply -f -; done
kubectl -n "$NAMESPACE" rollout status deployment/session-lab --timeout=120s
