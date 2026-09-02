# cloudnt

Portapapeles compartido entre máquinas. Abres una sala, dictas un código de cinco
letras en la otra pantalla, y lo que escribes en una aparece en la otra. Sin cuenta,
sin instalar nada, y todo se borra solo.

Nace de un caso concreto: sacar texto de una VM o de un escritorio remoto donde el
portapapeles no cruza y no hay forma de pegar un enlace. Por eso el código se dice en
voz alta y se teclea a mano, y por eso el alfabeto no tiene `i`, `l`, `o` ni `1`.

La especificación completa está en [cloudnt-spec.md](cloudnt-spec.md).

## Cómo funciona

- **Salas efímeras.** Mueren a las 2 h sin actividad o a las 24 h de vida, lo que
  llegue antes. Nada se archiva.
- **El dueño aprueba.** Quien entra con el código espera; el dueño ve una huella
  corta del visitante y decide. Tras tres rechazos de huellas distintas el código
  rota solo.
- **Texto e historial.** Sincronización con detección de conflicto por revisión y las
  últimas 10 pegadas guardadas.
- **Archivos.** Subida por trozos de 5 MB, reanudable: si la conexión se corta, el
  cliente pregunta qué llegó y sigue desde ahí.
- **Sin assets externos.** Ni fuentes web ni paquetes de iconos. La primera carga son
  22 kB brotli.

## Requisitos

[Bun](https://bun.sh) 1.4 o superior. Nada más: SQLite viene dentro de Bun y no hay
dependencias de sistema.

## Desarrollo

```sh
bun install
bun run dev
```

Levanta el servidor en `:3000` y Vite en `:5173` con proxy de `/api` y `/ws`. Se
trabaja contra `http://localhost:5173`.

En modo desarrollo el servidor **no** sirve el cliente: devuelve 404 en cualquier ruta
que no sea de API, a propósito, para que no haya duda de quién está sirviendo qué.

| Comando | Qué hace |
|---|---|
| `bun run dev` | servidor y cliente juntos |
| `bun run dev:server` | solo el servidor, con recarga |
| `bun run dev:web` | solo Vite |
| `bun run build` | compila el cliente en `web/dist/` |
| `bun run start` | producción: sirve API y cliente desde un solo proceso |
| `bun run typecheck` | `tsc --noEmit` |

## Configuración

Todo por variables de entorno, todo con un valor por defecto sensato.

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3000` | puerto de escucha |
| `CLOUDNT_HOST` | `127.0.0.1` | interfaz. Loopback a propósito: un `bun run` suelto no abre la LAN |
| `NODE_ENV` | — | `production` activa el servido del cliente |
| `CLOUDNT_DATA` | `./data` | directorio de la base SQLite |
| `CLOUDNT_FILES` | `$CLOUDNT_DATA/files` | directorio de archivos subidos |
| `CLOUDNT_TRUST_PROXY` | — | `1` para hacer caso a `x-forwarded-for` |

`CLOUDNT_TRUST_PROXY` merece cuidado. Sin proxy delante la cabecera la controla quien
llama, y entonces toda cuota por IP deja de existir: basta un valor nuevo por petición
para probar códigos sin límite. Actívala solo cuando haya un proxy que la escriba, y
asegúrate de que sea **exactamente un salto** — el servidor lee el último elemento de
la cadena, que es el único que un proxy que añade no puede falsificar.

Los límites de abuso viven en [`server/config.ts`](server/config.ts) y no son
configurables por entorno: son decisiones de diseño, no de despliegue.

| | |
|---|---|
| salas por IP y hora | 10 |
| intentos de entrada por IP / 5 min | 20 |
| salas concurrentes | 500 |
| miembros por sala | 16 |
| texto por sala | 8 MB |
| archivo suelto | 2 GB |
| tráfico por sala | 5 GB |
| archivos por sala | 20 |

## Despliegue en una VM

### Dimensionar

El techo del código son **8 000 clientes** (500 salas × 16). Para llegar ahí el orden
en que aparecen los cuellos de botella es: descriptores de fichero (uno por conexión,
y `ulimit -n` son 1 024 por defecto), luego RAM, luego escrituras a SQLite, y en la
práctica el ancho de banda antes que ninguno.

El disco es el número que sorprende. Cada sala puede mover 5 GB, y hay 500 salas: el
peor caso son **2,5 TB**. No hay tope global de disco, solo por sala. Con el TTL de
24 h el suelo se recicla a diario, así que para uso normal el riesgo real no es el uso
legítimo sino que alguien decida llenarte el disco a propósito.

| | Uso personal o de equipo | Público, con margen |
|---|---|---|
| vCPU | 1 | 2 |
| RAM | 1 GB | 2 GB |
| Disco | 40 GB | 80 GB + alerta al 80 % |

El trabajo es todo E/S, así que la CPU casi nunca es el límite.

### Instalar

Debian 13 o Ubuntu 24.04. Como `root`:

```sh
adduser --system --group --home /opt/cloudnt cloudnt
apt update && apt install -y git unzip
sudo -u cloudnt bash -c 'curl -fsSL https://bun.sh/install | bash'
```

Bun queda en `/opt/cloudnt/.bun/bin/bun`.

```sh
git clone <url-del-repo> /opt/cloudnt/app
chown -R cloudnt:cloudnt /opt/cloudnt/app
sudo -u cloudnt bash -c 'cd /opt/cloudnt/app && /opt/cloudnt/.bun/bin/bun install && /opt/cloudnt/.bun/bin/bun run build'
```

La ruta va completa a propósito: `cloudnt` es un usuario de sistema sin shell de
acceso, así que su `PATH` no incluye `~/.bun/bin`.

El servidor busca el cliente en `../web/dist/` relativo a `server/index.ts`, así que
hay que desplegar el árbol del repo entero, no solo un artefacto suelto.

### systemd

`/etc/systemd/system/cloudnt.service`:

```ini
[Unit]
Description=cloudnt
After=network.target

[Service]
Type=simple
User=cloudnt
Group=cloudnt
WorkingDirectory=/opt/cloudnt/app
Environment=NODE_ENV=production
Environment=CLOUDNT_DATA=/var/lib/cloudnt
Environment=CLOUDNT_TRUST_PROXY=1
ExecStart=/opt/cloudnt/.bun/bin/bun run server/index.ts
Restart=always
RestartSec=2

# Un descriptor por conexión. Con los 1024 de serie el techo real son ~900 clientes.
LimitNOFILE=65535

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
StateDirectory=cloudnt

[Install]
WantedBy=multi-user.target
```

`StateDirectory=cloudnt` crea `/var/lib/cloudnt` con el dueño correcto, que es lo que
hace compatible `ProtectSystem=strict` con que la aplicación escriba.

```sh
systemctl daemon-reload && systemctl enable --now cloudnt
```

### TLS y proxy inverso

Caddy, porque resuelve el certificado solo y pasa WebSocket sin configuración.

```sh
apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
cloudnt.org {
	reverse_proxy 127.0.0.1:3000
}
```

Eso es todo: Caddy no bufferea las respuestas, así que el canal SSE de respaldo llega
sin retención, y el WebSocket se actualiza sin declarar nada.

Apunta un registro `A` de `cloudnt.org` a la IP de la VM antes de recargar, o el
certificado no se emitirá.

```sh
systemctl reload caddy
ufw allow 22,80,443/tcp && ufw enable
```

### Si además pones Cloudflare delante

Con el proxy naranja activado son **dos saltos**, y ahí `CLOUDNT_TRUST_PROXY=1` se
vuelve en tu contra: Cloudflare escribe la IP del cliente, Caddy añade la de
Cloudflare detrás, y el servidor lee la última. Todas las cuotas por IP colapsarían
sobre un puñado de direcciones de Cloudflare.

La solución es que Caddy reescriba la cabecera con la IP real en lugar de añadirse:

```
cloudnt.org {
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
	}
}
```

Con DNS gris (sin proxy de Cloudflare) el `Caddyfile` simple ya es correcto.

## Operación

**Copias de seguridad: ninguna.** Todo caduca en 24 h como máximo, así que no hay nada
que valga la pena conservar. Perder `/var/lib/cloudnt` cuesta las salas abiertas en
ese momento, y nada más.

**Actualizar:**

```sh
sudo -u cloudnt bash -c 'cd /opt/cloudnt/app && git pull \
  && /opt/cloudnt/.bun/bin/bun install && /opt/cloudnt/.bun/bin/bun run build'
systemctl restart cloudnt
```

El reinicio corta las conexiones, pero el cliente reconecta solo y las salas viven en
SQLite. Lo que se pierde es estado en memoria y todo es prescindible: los tickets de
descarga (30 s de vida) y las ventanas de rate limit.

**Ver qué pasa:**

```sh
journalctl -u cloudnt -f
du -sh /var/lib/cloudnt/files
```

Vigila ese `du`. Es la única métrica del sistema sin tope automático.

## Estructura

```
server/     API Bun: salas, aprobación, texto, archivos, bus de eventos
web/src/    cliente Preact
scripts/    utilidades de desarrollo
```

| Archivo | Responsabilidad |
|---|---|
| `server/index.ts` | rutas HTTP, WebSocket, SSE, barrido periódico |
| `server/rooms.ts` | ciclo de vida de salas, miembros, aprobación, TTL |
| `server/files.ts` | subida por trozos, cuota, descarga |
| `server/bus.ts` | pub/sub por tema, común a WebSocket y SSE |
| `server/limits.ts` | ventanas deslizantes por IP, en memoria |
| `server/db.ts` | esquema SQLite y pragmas |

## Licencia

Sin definir.
