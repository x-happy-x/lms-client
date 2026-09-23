#!/opt/bin/sh
set -eu

TARGET_DIR="${1:-/opt/routerd}"
INIT_SRC="$TARGET_DIR/init.d/S99routerd"
INIT_DST="/opt/etc/init.d/S99routerd"
NGINX_INIT_SRC="$TARGET_DIR/init.d/S98nginx-local-conf"
NGINX_INIT_DST="/opt/etc/init.d/S98nginx-local-conf"
NGINX_SRC="$TARGET_DIR/nginx/router.conf"
NGINX_DST="/opt/etc/nginx/conf.d/router.conf"

if [ -f "$NGINX_INIT_SRC" ]; then
  chmod +x "$NGINX_INIT_SRC"
  ln -sf "$NGINX_INIT_SRC" "$NGINX_INIT_DST"
fi

if [ -f "$INIT_SRC" ]; then
  chmod +x "$INIT_SRC"
  ln -sf "$INIT_SRC" "$INIT_DST"
fi

if [ -f "$NGINX_SRC" ]; then
  ln -sf "$NGINX_SRC" "$NGINX_DST"
fi

if [ -x "$INIT_DST" ]; then
  "$INIT_DST" restart || "$INIT_DST" start || true
fi

if [ -x "$NGINX_INIT_DST" ]; then
  "$NGINX_INIT_DST" restart || true
elif command -v nginx >/dev/null 2>&1; then
  nginx -t && nginx -s reload || true
fi

echo "OK: routerd linked from $TARGET_DIR"
