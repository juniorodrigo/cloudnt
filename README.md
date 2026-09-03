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

Para trabajar en el código, sigue con [Desarrollo](#desarrollo). Para ponerlo en un
servidor, salta a [Despliegue](#despliegue).

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

## Despliegue

Cuatro pasos, en orden, sobre Debian 13 o Ubuntu 24.04 y como `root`. Los tres
primeros dejan la aplicación corriendo; el cuarto no da recetas, solo dice qué
necesita el servidor de lo que decidas poner delante.

Antes de empezar, mira [Dimensionar](#dimensionar) si vas a abrirlo al público.

### 1. Crear el usuario e instalar Bun

```sh
adduser --system --group --home /opt/cloudnt cloudnt
apt update && apt install -y git unzip
sudo -u cloudnt bash -c 'curl -fsSL https://bun.sh/install | bash'
```

Bun queda en `/opt/cloudnt/.bun/bin/bun`.

### 2. Clonar y compilar

```sh
git clone <url-del-repo> /opt/cloudnt/app
chown -R cloudnt:cloudnt /opt/cloudnt/app
sudo -u cloudnt bash -c 'cd /opt/cloudnt/app && /opt/cloudnt/.bun/bin/bun install && /opt/cloudnt/.bun/bin/bun run build'
```

Si clonas en otra ruta, cámbiala en los tres comandos de arriba y en el
`WorkingDirectory` del paso 3.

La ruta a `bun` va completa porque `cloudnt` es un usuario de sistema sin shell:
su `PATH` no incluye `~/.bun/bin`. Y se despliega el árbol del repo entero, no un
artefacto suelto, porque el servidor busca el cliente en `web/dist/` relativo a
`server/index.ts`.

### 3. Crear el servicio

Crea el archivo `/etc/systemd/system/cloudnt.service` — no existe todavía — con
este contenido:

```ini
[Unit]
Description=cloudnt
After=network.target

[Service]
Type=simple
User=cloudnt
Group=cloudnt
# La ruta donde clonaste en el paso 2. Si no coincide, systemd falla con
# status=200/CHDIR antes siquiera de arrancar Bun.
WorkingDirectory=/opt/cloudnt/app
ExecStart=/opt/cloudnt/.bun/bin/bun run server/index.ts
Restart=always
RestartSec=2

# Sin esto el servidor devuelve 404 en todo lo que no sea /api, a propósito.
Environment=NODE_ENV=production
# Por defecto son 3000. Si lo cambias, cámbialo también en lo que pongas delante.
Environment=PORT=3067
# Solo si pones algo delante: ver el paso 4, que es donde se decide la cabecera.
# Sin nada delante, borra estas dos líneas.
Environment=CLOUDNT_TRUST_PROXY=1
Environment=CLOUDNT_CLIENT_IP_HEADER=x-forwarded-for
# Ajústalo a tu disco: aquí son 20 GB.
Environment=CLOUDNT_DISK_BYTES=21474836480
Environment=CLOUDNT_DATA=/var/lib/cloudnt

# Un descriptor por conexión. Con los 1024 de serie el techo real son ~900 clientes.
LimitNOFILE=65535

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
# Crea /var/lib/cloudnt con el dueño correcto, que es lo que hace compatible
# ProtectSystem=strict con que la aplicación escriba.
StateDirectory=cloudnt

[Install]
WantedBy=multi-user.target
```

Arráncalo y comprueba que responde:

```sh
systemctl daemon-reload && systemctl enable --now cloudnt
curl -sI http://127.0.0.1:3067/   # 200 OK
journalctl -u cloudnt -n 30
```

En este punto la aplicación funciona, escuchando solo en loopback. Publicarla es el
paso 4.

### 4. Exponerlo

Cómo la publicas es decisión tuya: proxy inverso, túnel, o abrir el puerto si la
máquina tiene IP pública. El servidor solo pide dos cosas de lo que pongas delante.

**Que le diga la IP real del cliente.** Detrás de cualquier intermediario todas las
peticiones llegan desde `127.0.0.1`, y las cuotas por IP se colapsan en un único cubo
compartido por todo internet: 10 salas por hora en total. Para eso están
`CLOUDNT_TRUST_PROXY=1` y `CLOUDNT_CLIENT_IP_HEADER` en la unit.

Pon en la segunda la cabecera que escriba tu intermediario, y comprueba que la
**sobrescribe** en lugar de añadirse. El servidor lee el último elemento de la cadena,
así que una cabecera a la que el cliente pueda anteponer su propio valor deja las
cuotas en nada: basta un valor nuevo por petición para probar códigos sin límite. Con
Cloudflare delante la que cumple eso es `cf-connecting-ip`, no `x-forwarded-for`.

Si no hay nada delante, **quita esas dos líneas de la unit**. Sin proxy la cabecera la
controla quien llama.

**Que no estorbe a las conexiones largas.** El resto ya está resuelto en el código: el
latido del WebSocket va cada 25 s, por debajo del corte de inactividad habitual de
100 s; el canal SSE de respaldo viaja con `cache-control: no-transform` y
`x-accel-buffering: no`, que es lo que impide que un proxy lo retenga en un búfer; y
ningún trozo de subida pasa de 5 MB, por debajo del tope de tamaño de petición de
cualquier CDN.

### Dimensionar

| | Uso personal o de equipo | Público, con margen |
|---|---|---|
| vCPU | 1 | 2 |
| RAM | 1 GB | 2 GB |
| Disco | 40 GB | 80 GB |
| `CLOUDNT_DISK_BYTES` | 20 GB | 50 GB |

El trabajo es todo E/S, así que la CPU casi nunca es el límite. El techo del código son
**8 000 clientes** (500 salas × 16), y hasta ahí los cuellos de botella aparecen en
este orden: descriptores de fichero, RAM, escrituras a SQLite, y en la práctica el
ancho de banda antes que ninguno.

El disco no se calcula con los límites por sala, porque esos se multiplican: 500 salas
de 5 GB son 2,5 TB. Manda `CLOUDNT_DISK_BYTES`, que es un tope duro sobre todo lo
almacenado a la vez. Ponlo por debajo del disco real y olvídate.

### Las descargas son el punto débil

Los archivos se sirven desde el propio proceso, así que cada byte descargado sale por
la subida de la máquina. En una conexión doméstica eso es una fracción de la bajada: un
archivo de 1 GB la satura durante minutos. Y si delante hay un CDN, los planes
gratuitos suelen reservarse para contenido principalmente HTML y desaconsejar por
contrato servir archivos grandes — una aplicación de transferencia con tope de 1 GB por
archivo es exactamente el caso al que apuntan esas cláusulas.

Ambos se arreglan igual: sacar los archivos a almacenamiento S3 y servirlos con URL
firmada, de modo que los bytes no pasen ni por tu línea ni por el CDN. Mientras eso no
esté, baja `fileBytes` en `server/config.ts` a algo que tu subida tolere.

## Configuración

Referencia de las variables de entorno. Todas tienen un valor por defecto sensato, y
la unit del paso 3 ya trae puestas las que importan en producción.

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

`CLOUDNT_TRUST_PROXY=1` solo va cuando hay de verdad un proxy delante que escriba esa
cabecera. Sin proxy la controla quien llama, y toda cuota por IP deja de existir: basta
un valor nuevo por petición para probar códigos sin límite.

`CLOUDNT_DISK_BYTES` cuenta el tamaño **declarado** de cada archivo desde que se
anuncia, no el que ha llegado, para que varias subidas simultáneas no atraviesen el
mismo hueco libre. Déjale margen sobre el disco real.

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
archivos comparten el mismo gigabyte. El pie de la sala lo muestra como porcentaje, y
al llegar al 100 % la sala pasa a sólo lectura — se puede seguir leyendo y descargando,
pero nada nuevo entra hasta que se borre algo. Encogerse siempre se permite, o el
límite bloquearía la salida del límite.

El tráfico va aparte, porque cuenta bytes movidos y no ocupados: un archivo descargado
diez veces sigue ocupando su tamaño una sola vez.

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
