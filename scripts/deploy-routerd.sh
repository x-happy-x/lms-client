#!/usr/bin/env bash
set -euo pipefail

# Build routerd + web/ui and deploy runtime files to router over SSH.
# Loads env from DEPLOY_ENV_FILE (default: scripts/deploy-routerd.env) if present.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-${SCRIPT_DIR}/deploy-routerd.env}"

if [[ -f "${DEPLOY_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${DEPLOY_ENV_FILE}"
fi

ROUTER_HOST="${ROUTER_HOST:-}"
ROUTER_USER="${ROUTER_USER:-root}"
ROUTER_PORT="${ROUTER_PORT:-22}"
ROUTER_PASSWORD="${ROUTER_PASSWORD:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/routerd}"
SSH_OPTS="${SSH_OPTS:-}"

GOOS="${GOOS:-linux}"
GOARCH="${GOARCH:-mipsle}"
GOMIPS="${GOMIPS:-softfloat}"
CGO_ENABLED="${CGO_ENABLED:-0}"

RESTART_APP="${RESTART_APP:-1}"
RESTART_CMD="${RESTART_CMD:-/opt/etc/init.d/S99routerd restart}"
LINK_INITD="${LINK_INITD:-1}"
LINK_NGINX="${LINK_NGINX:-1}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:18080/api/ui/system/health}"

if [[ -z "${ROUTER_HOST}" ]]; then
  echo "ERROR: ROUTER_HOST is required"
  echo "Example: ROUTER_HOST=192.168.1.1 scripts/deploy-routerd.sh"
  exit 1
fi

for cmd in ssh tar go; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd command not found"
    exit 1
  fi
done

if [[ "${SKIP_FRONTEND}" != "1" ]] && ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm command not found (required for UI build)"
  exit 1
fi

SSH_TARGET="${ROUTER_USER}@${ROUTER_HOST}"
SSH_BASE=(ssh -p "${ROUTER_PORT}")
if [[ -n "${SSH_OPTS}" ]]; then
  # shellcheck disable=SC2206
  EXTRA_OPTS=( ${SSH_OPTS} )
  SSH_BASE+=("${EXTRA_OPTS[@]}")
fi

if [[ -n "${ROUTER_PASSWORD}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "ERROR: ROUTER_PASSWORD is set, but sshpass is not installed"
    exit 1
  fi
  SSH_BASE=(sshpass -p "${ROUTER_PASSWORD}" "${SSH_BASE[@]}")
fi

BUILD_DIR="${REPO_ROOT}/build"
mkdir -p "${BUILD_DIR}"

echo "[1/6] Build routerd binary (${GOOS}/${GOARCH}, GOMIPS=${GOMIPS})"
cd "${REPO_ROOT}"
CGO_ENABLED="${CGO_ENABLED}" GOOS="${GOOS}" GOARCH="${GOARCH}" GOMIPS="${GOMIPS}" \
  go build -o "${BUILD_DIR}/routerd" ./cmd/routerd

if [[ "${SKIP_FRONTEND}" != "1" ]]; then
  echo "[2/6] Build frontend"
  cd "${REPO_ROOT}/web/ui"
  if [[ "${SKIP_INSTALL}" == "1" ]]; then
    echo "Skip npm install (SKIP_INSTALL=1)"
  else
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  fi
  npm run build

  if [[ ! -f "${REPO_ROOT}/web/ui/dist/index.html" ]]; then
    echo "ERROR: web/ui/dist/index.html not found after build"
    exit 1
  fi
else
  echo "[2/6] Skip frontend build (SKIP_FRONTEND=1)"
fi

echo "[3/6] Ensure remote directories"
"${SSH_BASE[@]}" "${SSH_TARGET}" "mkdir -p '${REMOTE_DIR}/bin' '${REMOTE_DIR}/config' '${REMOTE_DIR}/static' '${REMOTE_DIR}/init.d' '${REMOTE_DIR}/nginx'"

echo "[4/6] Upload binary/config/init/nginx"
cd "${REPO_ROOT}"
tar -cf - \
  build/routerd \
  deploy/config.example.yml \
  deploy/entware/init.d/S98nginx-local-conf \
  deploy/entware/init.d/S99routerd \
  deploy/nginx/router.conf | "${SSH_BASE[@]}" "${SSH_TARGET}" "tar -xf - -C '${REMOTE_DIR}'"

"${SSH_BASE[@]}" "${SSH_TARGET}" "mv -f '${REMOTE_DIR}/build/routerd' '${REMOTE_DIR}/bin/routerd'; mv -f '${REMOTE_DIR}/deploy/config.example.yml' '${REMOTE_DIR}/config/config.yml'; mv -f '${REMOTE_DIR}/deploy/entware/init.d/S98nginx-local-conf' '${REMOTE_DIR}/init.d/S98nginx-local-conf'; mv -f '${REMOTE_DIR}/deploy/entware/init.d/S99routerd' '${REMOTE_DIR}/init.d/S99routerd'; mv -f '${REMOTE_DIR}/deploy/nginx/router.conf' '${REMOTE_DIR}/nginx/router.conf'; rm -rf '${REMOTE_DIR}/build' '${REMOTE_DIR}/deploy'"

if [[ "${SKIP_FRONTEND}" != "1" ]]; then
  echo "[5/6] Upload static UI"
  tar -cf - -C "${REPO_ROOT}/web/ui/dist" . | "${SSH_BASE[@]}" "${SSH_TARGET}" "tar -xf - -C '${REMOTE_DIR}/static'"
fi

echo "[6/6] Link services and restart"
REMOTE_SETUP="chmod +x '${REMOTE_DIR}/init.d/S98nginx-local-conf' '${REMOTE_DIR}/init.d/S99routerd';"
if [[ "${LINK_INITD}" == "1" ]]; then
  REMOTE_SETUP+=" ln -sf '${REMOTE_DIR}/init.d/S98nginx-local-conf' /opt/etc/init.d/S98nginx-local-conf;"
  REMOTE_SETUP+=" ln -sf '${REMOTE_DIR}/init.d/S99routerd' /opt/etc/init.d/S99routerd;"
fi
if [[ "${LINK_NGINX}" == "1" ]]; then
  REMOTE_SETUP+=" ln -sf '${REMOTE_DIR}/nginx/router.conf' /opt/etc/nginx/conf.d/router.conf;"
fi
REMOTE_SETUP+=" chmod +x '${REMOTE_DIR}/bin/routerd';"
"${SSH_BASE[@]}" "${SSH_TARGET}" "${REMOTE_SETUP}"

if [[ "${RESTART_APP}" == "1" ]]; then
  "${SSH_BASE[@]}" "${SSH_TARGET}" "
    set -eu
    ${RESTART_CMD} || true
    if command -v curl >/dev/null 2>&1; then
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        if curl -fsS '${HEALTHCHECK_URL}' >/dev/null 2>&1; then
          break
        fi
        sleep 1
      done
      if ! curl -fsS '${HEALTHCHECK_URL}' >/dev/null 2>&1; then
        killall routerd 2>/dev/null || true
        sleep 1
        /opt/etc/init.d/S99routerd start
        for _ in 1 2 3 4 5 6 7 8 9 10; do
          if curl -fsS '${HEALTHCHECK_URL}' >/dev/null 2>&1; then
            break
          fi
          sleep 1
        done
      fi
      curl -fsS '${HEALTHCHECK_URL}' >/dev/null
    fi
    if [ -x /opt/etc/init.d/S98nginx-local-conf ]; then
      /opt/etc/init.d/S98nginx-local-conf restart
    else
      nginx -t && nginx -s reload || true
    fi
  "
fi

"${SSH_BASE[@]}" "${SSH_TARGET}" "ls -la '${REMOTE_DIR}/bin/routerd' '${REMOTE_DIR}/config/config.yml' '${REMOTE_DIR}/init.d/S98nginx-local-conf' '${REMOTE_DIR}/init.d/S99routerd' '${REMOTE_DIR}/nginx/router.conf'; /opt/etc/init.d/S98nginx-local-conf status || true; /opt/etc/init.d/S99routerd status || true"

echo "Done: deployed to ${SSH_TARGET}:${REMOTE_DIR}"
