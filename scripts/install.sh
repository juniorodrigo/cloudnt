#!/usr/bin/env bash
#
# Installs cloudnt as a systemd service. Run as root from the repo:
#
#   ./scripts/install.sh
#
# Idempotent: re-run it after a `git pull` to rebuild and restart. Settings live
# in /etc/cloudnt.env, which is written once and never overwritten.
set -euo pipefail

USER_NAME=cloudnt
HOME_DIR=/opt/cloudnt
BUN="$HOME_DIR/.bun/bin/bun"
UNIT=/etc/systemd/system/cloudnt.service
ENV_FILE=/etc/cloudnt.env
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

command -v curl >/dev/null && command -v unzip >/dev/null ||
	{ apt-get update && apt-get install -y curl unzip; }

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

if [ ! -f "$ENV_FILE" ]; then
	cat >"$ENV_FILE" <<EOF
PORT=${PORT:-3067}
# All interfaces: a service installed to be reached has to be reachable. Put it
# back to 127.0.0.1 if you front it with a proxy on this same machine.
CLOUDNT_HOST=0.0.0.0
CLOUDNT_DATA=/var/lib/cloudnt
# Adjust to the disk. 20 GB.
CLOUDNT_DISK_BYTES=21474836480

# Only with a real proxy in front that overwrites this header. Without one the
# caller sets it and every per-IP quota stops existing.
#CLOUDNT_TRUST_PROXY=1
#CLOUDNT_CLIENT_IP_HEADER=x-forwarded-for
EOF
	echo "settings in $ENV_FILE"
fi

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
EnvironmentFile=$ENV_FILE
# Without this the server answers 404 on anything that is not /api, by design.
Environment=NODE_ENV=production
Restart=always
RestartSec=2

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

systemctl daemon-reload
systemctl reset-failed cloudnt 2>/dev/null || true
systemctl enable cloudnt >/dev/null
systemctl restart cloudnt

port="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)"
for _ in $(seq 20); do
	code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)"
	[ "$code" = "200" ] && break
	sleep 1
done

if [ "$code" != "200" ]; then
	echo "el servicio no responde (HTTP $code)" >&2
	journalctl -u cloudnt -n 30 --no-pager >&2
	exit 1
fi

echo
echo "cloudnt escuchando en el puerto $port"
echo "Ajustes: $ENV_FILE (tras editarlo: systemctl restart cloudnt)"
echo "Logs:    journalctl -u cloudnt -f"
