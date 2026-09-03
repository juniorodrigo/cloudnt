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
- **Texto e historial.** Editor con formato (negrita, cursiva, tachado, listas) e
  imágenes incrustadas. Sincronización con detección de conflicto por revisión y las
  pegadas guardadas sin tope: caben las que quepan en el gigabyte de la sala.
- **Archivos.** Subida por trozos de 5 MB, reanudable: si la conexión se corta, el
  cliente pregunta qué llegó y sigue desde ahí.
- **Sin assets externos.** Ni fuentes web ni paquetes de iconos. La primera carga son
  38 kB brotli.

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
| `CLOUDNT_TRUST_PROXY` | — | `1` para hacer caso a la cabecera de IP del proxy |
| `CLOUDNT_CLIENT_IP_HEADER` | `x-forwarded-for` | qué cabecera trae la IP del cliente |
| `CLOUDNT_DISK_BYTES` | `20 GB` | tope global de disco |

`CLOUDNT_TRUST_PROXY` merece cuidado. Sin proxy delante la cabecera la controla quien
llama, y entonces toda cuota por IP deja de existir: basta un valor nuevo por petición
para probar códigos sin límite. Actívala solo cuando haya un proxy que la escriba.

Detrás de Cloudflare, pon además `CLOUDNT_CLIENT_IP_HEADER=cf-connecting-ip`. El
motivo está más abajo, y no es opcional.

`CLOUDNT_DISK_BYTES` es el único tope que mira el disco entero. Los límites de abajo
son por sala y se multiplican en lugar de acumularse, así que sin él el techo teórico
son 2,5 TB. Ajústalo al disco de la máquina dejando margen: la cuenta reserva el
tamaño **declarado** de cada archivo desde que se anuncia, no el que ha llegado, para
que varias subidas simultáneas no atraviesen el mismo hueco libre.

Los límites de abuso viven en [`server/config.ts`](server/config.ts) y no son
configurables por entorno: son decisiones de diseño, no de despliegue.

| | |
|---|---|
| salas por IP y hora | 10 |
| intentos de entrada por IP / 5 min | 20 |
| salas concurrentes | 500 |
| miembros por sala | 16 |
| texto por sala | 8 MB |
| archivo suelto | 1 GB |
| almacenamiento por sala | 1 GB |
| tráfico por sala | 5 GB |
| archivos por sala | 20 |

El almacenamiento es un presupuesto único: el texto del editor, las pegadas y los
archivos comparten el mismo gigabyte. El pie de la sala lo muestra como
porcentaje, y al llegar al 100 % la sala pasa a sólo lectura — se puede seguir
leyendo y descargando, pero nada nuevo entra hasta que se borre algo. Encogerse
siempre se permite, o el límite bloquearía la salida del límite.

El tráfico va aparte, porque cuenta bytes movidos y no ocupados: un archivo
descargado diez veces sigue ocupando su tamaño una sola vez.

## Despliegue

Sirve igual para una VM con IP pública que para una máquina en casa detrás de un
router: el túnel de la sección correspondiente resuelve el segundo caso.

### Dimensionar

El techo del código son **8 000 clientes** (500 salas × 16). Para llegar ahí el orden
en que aparecen los cuellos de botella es: descriptores de fichero (uno por conexión,
y `ulimit -n` son 1 024 por defecto), luego RAM, luego escrituras a SQLite, y en la
práctica el ancho de banda antes que ninguno.

El disco no se dimensiona por los límites por sala, porque esos se multiplican: 500
salas de 5 GB son 2,5 TB. Lo que manda es `CLOUDNT_DISK_BYTES`, que es un tope duro
sobre todo lo almacenado a la vez. Ponlo por debajo del disco real y olvídate.

| | Uso personal o de equipo | Público, con margen |
|---|---|---|
| vCPU | 1 | 2 |
| RAM | 1 GB | 2 GB |
| Disco | 40 GB | 80 GB |
| `CLOUDNT_DISK_BYTES` | 20 GB | 50 GB |

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
Environment=CLOUDNT_DISK_BYTES=21474836480
Environment=CLOUDNT_TRUST_PROXY=1
Environment=CLOUDNT_CLIENT_IP_HEADER=cf-connecting-ip
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

### Exponerlo con Cloudflare Tunnel

Pensado para una máquina sin IP pública, detrás del router de casa. `cloudflared` abre
una conexión **saliente** hacia Cloudflare y el tráfico entra por ahí: no hay puertos
que abrir, ni redirección en el router, ni certificado que renovar, y la IP doméstica
no aparece en ningún DNS.

```sh
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  > /etc/apt/sources.list.d/cloudflared.list
apt update && apt install -y cloudflared
```

```sh
cloudflared tunnel login          # autoriza cloudnt.org en el navegador
cloudflared tunnel create cloudnt # imprime el UUID y deja el JSON de credenciales
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <UUID>
credentials-file: /etc/cloudflared/<UUID>.json
ingress:
  - hostname: cloudnt.org
    service: http://127.0.0.1:3000
  - service: http_status:404
```

```sh
cloudflared tunnel route dns cloudnt cloudnt.org   # crea el CNAME
cloudflared service install
systemctl enable --now cloudflared
```

El firewall entrante puede quedarse cerrado del todo:

```sh
ufw default deny incoming && ufw allow 22/tcp && ufw enable
```

### Lo que el túnel cambia para esta aplicación

**La IP del cliente es lo único que hay que configurar a mano.** Cloudflare escribe
`CF-Connecting-IP` en cada petición y siempre la sobrescribe, mientras que a
`X-Forwarded-For` se limita a añadirse: si quien llama manda su propio
`X-Forwarded-For`, ese valor sobrevive dentro de la cadena. Como el servidor lee el
último elemento, con `x-forwarded-for` dependerías de que ningún salto intermedio
añada nada después — algo que ni Cloudflare ni `cloudflared` garantizan por escrito.
Con `cf-connecting-ip` el valor entero lo pone el edge y la cuestión desaparece. De
ahí que la unit lleve `CLOUDNT_CLIENT_IP_HEADER=cf-connecting-ip`: sin eso, las cuotas
por IP se apoyan en una suposición.

**Lo demás ya está resuelto en el código.** El túnel pasa WebSocket sin configurar
nada. Cloudflare corta las conexiones HTTP inactivas a los 100 s, y el latido va cada
25 s. El canal SSE de respaldo ya viaja con `cache-control: no-transform` y
`x-accel-buffering: no`, que es justo lo que impide que el edge lo retenga. El plan
gratuito rechaza peticiones de más de 100 MB, y ningún trozo pasa de 5 MB.

**Las descargas son el problema, y son dos.** El primero es tu línea: cada byte que
alguien se descarga sale por la subida de tu conexión doméstica, que en fibra suele
ser una fracción de la bajada. Un archivo de 1 GB satura eso durante minutos. El
segundo es el contrato: la sección 2.8 de los términos de Cloudflare reserva el plan
gratuito para contenido principalmente HTML y desaconseja usarlo para servir archivos
grandes. Una aplicación de transferencia con un tope de 1 GB por archivo es
precisamente el caso al que apunta esa cláusula.

Las dos se arreglan igual: sacar los archivos a almacenamiento S3 y servirlos con URL
firmada, de modo que los bytes nunca pasen por tu casa ni por el CDN. Mientras eso no
esté, baja `fileBytes` en `server/config.ts` a algo que tu subida tolere.

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
journalctl -u cloudflared -f
```

Si ese `du` se acerca a `CLOUDNT_DISK_BYTES`, las subidas empiezan a responder `507` y
la interfaz dice que no queda espacio. Es contención, no un fallo: en cuanto caducan
salas el hueco vuelve. Si pasa a menudo, sube el tope o el disco.

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
