#!/usr/bin/env bash
#
# Installs cloudnt as a systemd service. Run as root from the repo:
#
#   ./scripts/install.sh
#
# Idempotent: re-run it after a `git pull` to rebuild and restart.
# Override the port with PORT=8080 ./scripts/install.sh
set -euo pipefail

USER_NAME=cloudnt
HOME_DIR=/opt/cloudnt
BUN="$HOME_DIR/.bun/bin/bun"
UNIT=/etc/systemd/system/cloudnt.service
PORT="${PORT:-3067}"
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
	echo "run as root" >&2
	exit 1
fi

# runuser rather than sudo: it ships with util-linux, and a minimal Debian may
# not have sudo at all. HOME is passed explicitly because runuser keeps root's.
as_app_user() {
	runuser -u "$USER_NAME" -- env "HOME=$HOME_DIR" "$@"
}

id "$USER_NAME" >/dev/null 2>&1 ||
	adduser --system --group --home "$HOME_DIR" "$USER_NAME"

if ! command -v curl >/dev/null || ! command -v unzip >/dev/null; then
	apt-get update
	apt-get install -y curl unzip
fi

[ -x "$BUN" ] ||
	as_app_user bash -c 'curl -fsSL https://bun.sh/install | bash'

chown -R "$USER_NAME:$USER_NAME" "$APP"
# The chown above is what git calls dubious ownership: without this exception a
# later `git pull` as root refuses to run in its own deployment directory.
git config --global --add safe.directory "$APP" 2>/dev/null || true

# env -u NODE_ENV because bun skips devDependencies when it is production, and
# vite — which the build needs — lives there.
as_app_user env -u NODE_ENV "$BUN" install --cwd "$APP"
as_app_user env -u NODE_ENV "$BUN" run --cwd "$APP" build

# An existing unit is left alone: by then it usually carries hand-added
# Environment= lines, and an update would silently drop them.
if [ -f "$UNIT" ] && [ "${FORCE:-}" != "1" ]; then
	echo "$UNIT ya existe, no se toca (FORCE=1 para regenerarla)"
else
	cat >"$UNIT" <<EOF
[Unit]
Description=cloudnt
After=network.target

[Service]
Type=simple
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$APP
ExecStart=$BUN run server/index.ts
Restart=always
RestartSec=2

# Without this the server answers 404 on anything that is not /api, by design.
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=CLOUDNT_DATA=/var/lib/cloudnt
# Adjust to the disk. 20 GB.
Environment=CLOUDNT_DISK_BYTES=21474836480

# One descriptor per connection. The stock 1024 caps the room at ~900 clients.
LimitNOFILE=65535

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
# Creates /var/lib/cloudnt owned by the service, which is what lets the app
# write while ProtectSystem=strict holds.
StateDirectory=cloudnt

[Install]
WantedBy=multi-user.target
EOF
	echo "unit escrita en $UNIT"
fi

systemctl daemon-reload
systemctl reset-failed cloudnt 2>/dev/null || true
systemctl enable --now cloudnt
systemctl restart cloudnt

sleep 2
# The unit may be an older one this run did not write, carrying its own port.
running_port="$(sed -n 's/^Environment=PORT=//p' "$UNIT" | tail -1)"
if [ -n "$running_port" ]; then
	PORT="$running_port"
fi
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
if [ "$code" = "200" ]; then
	echo
	echo "cloudnt corriendo en http://127.0.0.1:$PORT"
	echo "Unit: $UNIT   Logs: journalctl -u cloudnt -f"
	echo
	echo "Si pones un proxy o un tunel delante, anade a la unit:"
	echo "  Environment=CLOUDNT_TRUST_PROXY=1"
	echo "  Environment=CLOUDNT_CLIENT_IP_HEADER=<la cabecera que escriba>"
	echo "Sin eso las cuotas por IP se colapsan en una sola. Ver el paso 4 del README."
else
	echo "el servicio no responde (HTTP $code)" >&2
	journalctl -u cloudnt -n 30 --no-pager >&2
	exit 1
fi
