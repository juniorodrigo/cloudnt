# cloudnt — especificación técnica

Portapapeles compartido para mover texto y archivos entre máquinas cuando el
canal directo no existe: sesiones PAM (Delinea, CyberArk), bastiones, VDI,
KVM/IPMI, consolas de nube, o simplemente dos equipos que no comparten red.

`cloudnt.org`

---

## 1. Problema y enfoque

Mover un bloque de código a una VM sin portapapeles compartido es
desproporcionadamente molesto. Las opciones actuales fallan por razones
distintas y ninguna resuelve el caso completo:

- Los pastebin son públicos, persistentes e indexables. Sirven para publicar, no para transferir.
- Las herramientas P2P exigen que ambos lados estén conectados a la vez y suelen requerir emparejamiento manual.
- Las que sí sincronizan en vivo se apoyan en identificadores largos que hay que teclear a mano en un teclado remoto con lag y distribución ajena.
- Casi ninguna descarga los archivos automáticamente; hay que ir a buscarlos.

cloudnt cubre eso con cuatro decisiones:

| Decisión | Consecuencia |
|---|---|
| Código corto y único, tecleable en segundos | Entrar a la sala desde la VM no duele |
| Aprobación del dueño para cada dispositivo | Control de acceso sin cuentas ni contraseñas |
| Sesión efímera por inactividad | Nada queda vivo por descuido |
| Archivos borrados al confirmar recepción | El servidor es tránsito, no almacenamiento |

**La persistencia es una posibilidad abierta, no algo descartado.** El
comportamiento por defecto es efímero porque cubre la mayoría de los casos y
mantiene el sistema simple, pero fijar una sala para que sobreviva a la
inactividad es una función legítima del producto. Ver §3.5.

---

## 2. Modelo de acceso

### 2.1 Estados

```
entra con el código
      │
      ▼
 sala de espera ──────────► rechazado
      │
      ▼ aprobado por el dueño
 token de sala
      │
      ▼
sincronización en vivo ◄──── expulsable en cualquier momento
```

El visitante **no ve nada** mientras espera: una pantalla con su huella y un
mensaje. No se filtra contenido mientras el dueño decide.

### 2.2 Códigos

Cortos, únicos y de un solo uso por sala activa. Alfabeto
`abcdefghjkmnpqrstuvwxyz23456789` — sin `i l o 0 1`, que se confunden al
dictarse en voz alta y al leerse en consolas. Cuatro posiciones ≈ 923 000
combinaciones, ampliable a cinco si la concurrencia lo pide.

Dos formas de entrar, ambas de primera clase:

1. **`cloudnt.org/f4k2`** — el path precarga el código y salta directo a la sala de espera. Es lo que se comparte por chat, por QR o por correo.
2. **`cloudnt.org`** — la portada es un campo de cuatro casillas con el foco puesto. Para cuando hay que teclear a mano en un teclado remoto y la barra está en otro sitio según la distribución.

El código no es un secreto criptográfico; el control de acceso lo ejerce la
aprobación. Aun así se genera con un CSPRNG y se rota tras rechazos repetidos
(§2.5) para no invitar al sondeo.

### 2.3 Huella de verificación

El dueño no ve "alguien quiere entrar". Ve **dos palabras deterministas**
derivadas de IP + user-agent del visitante, tipo `cobre-pino`. La misma huella
aparece en la pantalla de espera del visitante.

Verificación fuera de banda sin teclear nada: miras la VM, dice `cobre-pino`;
miras tu laptop, dice `cobre-pino`; apruebas. Cubre el caso de que alguien
llegue a la sala justo mientras esperas a tu propio dispositivo.

Diccionario de ~256 palabras por posición → 65 536 combinaciones. Es detección
visual, no criptografía.

### 2.4 Tokens

| Token | Emisión | Almacenamiento | Alcance |
|---|---|---|---|
| `owner` | Al crear la sala | `localStorage` | Aprobar, expulsar, fijar, cerrar, configurar |
| `member` | Al ser aprobado | `localStorage` | Leer y escribir contenido |

Opacos, 32 bytes, válidos solo para su sala.

### 2.5 Sucesión del dueño

Único agujero real del modelo. Resuelto así:

1. El token de dueño persiste en `localStorage`; reabrir la pestaña recupera el control.
2. Si el dueño lleva **10 minutos desconectado**, el control pasa al miembro aprobado más antiguo que siga conectado.
3. Modo **auto-aprobar temporal** (5 min), para cuando se conectan varias VMs seguidas.

El traspaso se anuncia a todos los presentes.

### 2.6 Rotación del código

Tras **dos rechazos seguidos**, el código rota. Los miembros ya aprobados no se
ven afectados porque su token sigue vigente.

Se eligió dos y no uno a propósito: rotar al primer rechazo hace que un clic por
error deje la VM apuntando a un código muerto. Adicionalmente, el rechazo tiene
30 segundos de deshacer.

---

## 3. Ciclo de vida de la sesión

### 3.1 Actividad contra presencia

Distinción crítica. Si el TTL se reinicia con cualquier señal del cliente, una
pestaña olvidada mantiene la sala viva indefinidamente, y eso pasa siempre:
alguien deja la VM abierta el viernes y vuelve el lunes.

- **Presencia** — la conexión está viva. **No toca el TTL.** Solo alimenta el indicador de quién está conectado.
- **Actividad** — alguien mutó o consumió contenido. **Reinicia el TTL.**

Cuenta como actividad: escribir o borrar texto, subir un archivo, iniciar una
descarga, aprobar un dispositivo nuevo.

**No** cuenta: heartbeats, long poll, reconexiones, actualizaciones de presencia.

### 3.2 Plazos

| Parámetro | Valor | Motivo |
|---|---|---|
| TTL por inactividad | 2 h | Ventana de trabajo realista |
| Tope absoluto desde creación | 24 h | Red de seguridad contra bucles de actividad no previstos |
| Aviso al usuario | 10 min antes | Con botón "mantener viva" |
| Gracia para descargas en curso | 5 min | Ver §3.4 |

Ambos plazos se suspenden en salas fijadas (§3.5).

### 3.3 Expiración perezosa

El barrido periódico (60 s) libera espacio, pero **no es la garantía**. La
garantía es que toda lectura comprueba el TTL antes de servir. El barrido puede
ir retrasado; una lectura nunca devuelve contenido vencido.

### 3.4 Conteo de referencias

Si alguien está bajando 400 MB por una conexión lenta y el TTL vence a mitad, no
se puede borrar el archivo bajo sus pies.

```
TTL vence
   → sala marcada como `draining`
   → se rechazan lecturas nuevas
   → se espera a que activeReads == 0, o 5 min
   → unlink recursivo + purga del índice
```

### 3.5 Salas fijadas

El dueño puede **fijar** una sala para que sobreviva a la inactividad. Es una
acción explícita, reversible, y visible para todos los presentes.

**Sin registro obligatorio.** El anclaje es el token de dueño en `localStorage`,
más una **frase de recuperación** de 4 palabras que se muestra una única vez al
fijar. Esa frase reconstruye el acceso desde otro navegador. No se pide correo
ni se crea cuenta.

Diferencias frente a una sala efímera:

| | Efímera | Fijada |
|---|---|---|
| TTL por inactividad | 2 h | No aplica |
| Tope absoluto | 24 h | No aplica |
| Texto | Memoria | SQLite |
| Archivos | Borrados al confirmar recepción | Igual: se borran al confirmar |
| Índice | SQLite | SQLite |
| Caducidad | Automática | Manual, o 90 días sin ninguna visita |

Nótese que **el comportamiento de los archivos no cambia**. Fijar una sala
preserva el canal y el texto, no convierte al servidor en almacenamiento. Quien
quiera guardar un archivo, lo tiene en su disco.

**Tensión que hay que vigilar.** La persistencia debilita la postura contra el
abuso descrita en §9, que se apoya en que nada dura. Mitigaciones: límite de
salas fijadas por IP, caducidad por abandono a los 90 días, y la opción de
exigir verificación ligera solo para fijar. El registro no está descartado como
requisito **exclusivamente para esta función** si el abuso lo obliga; nunca
para el uso normal.

### 3.6 Cierre manual

El botón **Vaciar** del dueño es el único borrado inmediato e irrevocable. Sin
confirmación diferida ni papelera: es la salida de emergencia de quien acaba de
pegar algo que no debía.

---

## 4. Archivos

### 4.1 Recepción automática

El comportamiento central: **el archivo se descarga solo en cada cliente
aprobado apenas se sube**, sin que nadie haga clic.

Eso cambia el modelo de almacenamiento por completo. El servidor no guarda el
archivo por si alguien lo pide; lo guarda **hasta que todos los dispositivos
aprobados confirmaron recepción**. En la práctica, la vida de un archivo en el
servidor pasa de horas a unos 30 segundos.

```
subida por trozos
   → el servidor anuncia el archivo a la sala
   → cada cliente aprobado hace stream a disco
   → cada cliente confirma con checksum
   → todos confirmaron → unlink inmediato
```

**Ausentes.** Si un dispositivo aprobado está desconectado o no confirma en
15 minutos, sale del conteo y el archivo se borra igual. Al reconectar lo ve
listado como expirado, con opción de pedirlo de nuevo.

### 4.2 Requiere HTTPS

Streaming a disco necesita Service Workers, que no existen fuera de contexto
seguro.

| | HTTP plano / LAN | HTTPS |
|---|---|---|
| Texto sincronizado | ✅ | ✅ |
| Aprobación y ciclo de vida | ✅ | ✅ |
| Subida y descarga manual | ✅ | ✅ |
| Recepción automática | ❌ | ✅ |
| Archivos >100 MB | ❌ | ✅ |
| Copiar con un clic | ❌ (Ctrl+C) | ✅ |

El autohospedaje **sigue siendo útil de verdad**: el caso de uso original vive
entero en el núcleo. Y quien monte esto con su propio certificado (Caddy y un
dominio interno bastan) obtiene la experiencia completa. No es un muro
artificial, es una consecuencia de la plataforma. El instalador debe ofrecer
generar un certificado.

### 4.3 Escritura a disco

Ruta única, sin cascada de respaldos:

1. **`showSaveFilePicker()`** si existe (Chromium). Handle → `createWritable()` → escritura incremental, memoria plana.
2. **Service Worker + `ReadableStream`** en el resto. Se intercepta una URL virtual y se responde con un stream; el navegador lo trata como descarga normal, con progreso nativo.

Con streaming, el tamaño deja de importar.

**Un solo gesto por sesión.** La primera vez que llega un archivo, el usuario
pulsa "recibir archivos automáticamente en esta sala". Los siguientes llegan
solos.

El Service Worker se sirve desde `/sw.js` en la raíz, no desde la ruta de la
sala, para no registrar uno por cada sala visitada.

### 4.4 Subida por trozos

No es adorno. En redes corporativas inestables, una subida que falla al 90% y
hay que reempezar es la peor experiencia posible.

- Trozos de 5 MB, en secuencia
- `PUT /api/room/:code/file/:id/chunk/:n`
- Reanudación: el cliente pregunta qué trozos llegaron y sigue desde ahí
- El servidor ensambla en disco a medida que llegan; nunca en RAM
- Checksum SHA-256 verificado en ambos extremos

### 4.5 Estados en la interfaz

Tres estados explícitos por archivo. El tercero es el mejor argumento de
confianza del producto y ningún competidor lo muestra:

| Estado | Significado |
|---|---|
| **En tránsito** | Subiéndose o distribuyéndose |
| **En tu disco** | Recibido y verificado localmente |
| **Ya no está en el servidor** | Todos confirmaron; el servidor lo borró |

---

## 5. Texto

- Sincronización bidireccional por WebSocket, último-que-escribe-gana
- **Detección de conflicto**: si ambos lados editan a la vez no se pisa el texto local; aviso con "traer la nueva" / "conservar la mía"
- **Pegadas**: las últimas 10 de la sala, restaurables con un clic. Se guardan solas cuando un pegado reemplaza al anterior, y a mano con "fijar" para tener dos textos a la vez sin pisar ninguno. No se duplica lo que ya está en la lista. Convierte la app de buffer a portapapeles con memoria; es la función que hace que la gente vuelva
- **Resaltado de sintaxis** en modo lectura, con detección de lenguaje
- **Descargar como archivo**: para bloques grandes suele ser mejor que copiar
- **Pegado directo al crear sala**: si hay permiso de portapapeles, un botón único de "pegar lo que tengo copiado"

Sin CRDT. Yjs suena bien, pero el caso real es un lado escribiendo y otro
leyendo; el aviso de conflicto cubre el 99%.

---

## 6. Arquitectura

### 6.1 Stack

```
server/
  index.ts          Bun.serve — HTTP + WS + pub/sub por topic
  rooms.ts          estado, TTL, tokens, sucesión, fijado
  files.ts          trozos, ensamblado, conteo de referencias
  fingerprint.ts    IP + UA → dos palabras
  db.ts             bun:sqlite — índice y salas fijadas
web/
  Vite + Preact
  sw.ts             Service Worker de streaming
cli/
  cloudnt.ts        bunx cloudnt   (alias corto: cnt)
```

**Bun**, porque `Bun.serve` trae WebSockets con pub/sub por topic integrado:
`server.publish("room:f4k2", payload)`. Cada sala es un topic. No hace falta
Socket.io ni broker. El servidor son ~200 líneas.

**Preact, no React.** El cliente crítico corre en un navegador dentro de una VM
con red pésima, donde cada kilobyte de más es otro round-trip sobre un enlace
que pierde paquetes. Preact + Vite ahorra unos 30 KB comprimidos frente a React,
y esa diferencia se nota al cargar.

**Presupuesto de carga: 40 KB brotli en total**, sumando HTML, JS y CSS de la
primera carga. Es un techo, no una meta: hoy la app va por ~38 KB. La cifra que
importa es lo que viaja por el cable en la primera visita, no el tamaño de un
chunk suelto ni el de una dependencia concreta, así que gastar el margen en CSS
de diseño o en una pantalla más está bien mientras el total no se acerque al
techo. Lo caro no es el peso, es el número de viajes: la app debe seguir
cargando en una sola tanda de peticiones, sin fuentes ni chunks diferidos en el
camino crítico. Cuando el techo estorbe de verdad, se sube aquí y se justifica;
lo que no se hace es superarlo en silencio.

El techo era de 30 KB hasta que el editor pasó a ser rich-text. Pegar una imagen
dentro del texto obliga a renderizar marcado escrito por otro miembro de la sala,
y eso convierte el editor en la única superficie XSS del producto. DOMPurify son
~11 KB brotli y es la respuesta madura a ese problema; escribir el saneador a
mano habría salido más barato en bytes y mucho más caro en riesgo. Sigue siendo
una sola tanda de peticiones.

**Cero CDNs y cero fuentes externas.** Todo inline, stack de fuentes del
sistema. Si la VM no tiene salida a internet pero sí alcanza al servidor, la app
debe cargar igual. Esto sí es innegociable, y no depende del presupuesto: es
regla de build, no buena intención.

**WebSocket con respaldo a SSE.** Muchos proxies corporativos rompen el upgrade
a WS. Si el único canal es WebSocket, la app falla justo en el entorno para el
que se hizo.

### 6.2 Procesamiento

Prácticamente cero. No hay nada que computar: es I/O puro. Bun con WebSockets
aguanta miles de conexiones en una VM de 1 GB.

Los cuellos de botella reales son el **ancho de banda de salida** —lo único que
escala con el uso y lo único que cuesta plata— y la **RAM**, solo si se guardan
archivos en memoria. Por eso no se hace.

### 6.3 Almacenamiento

| Qué | Dónde | Por qué |
|---|---|---|
| Texto de sala efímera | Memoria | Kilobytes, latencia baja, va por pub/sub |
| Texto de sala fijada | `bun:sqlite` | Debe sobrevivir a reinicios |
| Archivos | Disco local, `/var/cloudnt/{sala}/{id}` | Servidos con `Bun.file()` → `sendfile`, sin pasar por RAM |
| Índice y metadatos | `bun:sqlite` | Sobrevive a reinicios |

**Nada de S3.** Objetos que viven 30 segundos dan lo peor de ambos mundos: se
paga por PUT y GET, se suma latencia, y el ciclo de vida tiene granularidad de
días, no de horas. Habría que borrar a mano igual.

Un volumen de 20 GB sobra. Con recepción automática, el residente real es lo que
está en tránsito ahora mismo.

### 6.4 El problema del reinicio

Con archivos en disco local y TTL de 2 h, **siempre hay sesiones vivas al
desplegar**. Sin persistencia del índice, cada despliegue mata sesiones.

Volumen persistente + índice en `bun:sqlite`, recuperado al arrancar. Son ~30
líneas y elimina el problema. Las salas fijadas dependen de esto por diseño.

### 6.5 WebRTC: descartado

Tentador para ahorrar ancho de banda, pero **el entorno objetivo es el más
hostil que existe para WebRTC**:

- Muchas empresas lo desactivan por política, precisamente porque filtra IPs internas. Si la VM tiene el clipboard bloqueado, hay probabilidad alta de que también tenga WebRTC apagado
- El UDP saliente suele estar bloqueado; sin STUN no hay conexión directa
- Queda TURN sobre TCP/443, que **relaya todo por el servidor de todas formas**: se paga el ancho de banda igual más la complejidad de operar coturn
- Exige que ambos lados estén conectados a la vez, lo que rompe el caso "subo ahora, abro la VM en cinco minutos"

Reevaluable más adelante como optimización opcional (intento P2P con
temporizador de 3 s y caída silenciosa al relay), no en el diseño base.

---

## 7. Interfaz

### 7.1 Tres pantallas

**Portada.** Un campo de código de cuatro casillas con el foco puesto, y debajo
un botón de crear sala. Nada más. Recuerda las salas recientes de ese navegador.

Entrar por `cloudnt.org/f4k2` salta esta pantalla: el código viene precargado y
se va directo a la sala de espera.

**Sala de espera.** Casi vacía. La huella de dos palabras en grande y "esperando
aprobación". Cero contenido.

**Sala.** El editor en vivo ocupa el centro, sin cromo propio: es el lienzo. Lo
enmarcan una barra arriba y un pie abajo, y a la derecha una columna con dos
pestañas: **Pegadas**, el historial de textos que se puede copiar, traer de
vuelta al editor o quitar; y **Archivos**, la lista con sus tres estados y la
zona de arrastre. Los archivos no van debajo del editor: comparten columna con
las pegadas y solo ocupan sitio cuando se piden. La columna arranca en 420 px y
se redimensiona arrastrando el separador; el ancho se recuerda por navegador.

En la **barra**, a la izquierda el código —con la marca como único distintivo,
porque aquí el código es la etiqueta, no el nombre—; en el centro las tres
acciones del texto: copiar, nueva pegada, descargar; y a la derecha dos botones
que abren paneles: **dispositivos**, con las solicitudes pendientes y la lista
con botón de expulsar, y **ajustes**, con el acceso —aprobación automática,
rotar código— y la zona de riesgo. Vaciar la sala y cerrarla piden confirmación
en un modal.

En el **pie**, lo que se consulta de reojo y nunca se pulsa: estado de conexión,
reloj de expiración —o el indicador de sala fijada—, peso del texto, estado de
sincronización y los atajos.

Por debajo de 760 px las columnas se apilan con el editor primero, el separador
desaparece y las acciones del texto se llevan una fila entera de la barra, con
sus etiquetas.

### 7.2 El reloj

No como cuenta regresiva agresiva, sino como dato: "se borra en 1 h 47 min sin
actividad". El reinicio se anota al lado —"· reiniciado"— en el mismo gris que
el resto del pie: legible si se mira, invisible si no. Cambiar de color cada vez
que alguien teclea convierte el mecanismo en una alarma, y lo que tiene que
transmitir es exactamente lo contrario.

En salas fijadas se sustituye por un indicador de estado y un acceso para
desfijar.

### 7.3 Teclado

El usuario está en una VM donde el mouse va con retraso. Todo debe ser operable
con teclado: copiar, descargar, saltar entre archivos, aprobar. Aquí la
accesibilidad es también rendimiento.

En la sala: `Alt+C` copia, `Alt+N` guarda el texto actual como pegada aparte y
`Alt+S` lo descarga. Se anuncian en el pie, porque un atajo que no se ve no
existe. El separador de la columna es un `separator` enfocable que se mueve con
las flechas.

---

## 8. Extras

### 8.1 CLI

`cloudnt < archivo.py` sube y devuelve el código. `cloudnt f4k2 > archivo.py`
baja. Alias corto `cnt` para uso diario.

Para un dev ya en la terminal es más rápido que abrir el navegador, y da
distribución gratis: se usa sin instalar nada vía `bunx`. Son ~80 líneas y
probablemente sea lo que más uso real genere.

### 8.2 Otros

- **QR del código** — para saltar de escritorio a móvil sin teclear
- **Quemar al leer** — interruptor por sala: cuando todos los aprobados recibieron, la sala se cierra sola
- **Presencia** — quién está conectado ahora mismo

### 8.3 Fuera de alcance

- **Cuentas obligatorias** — el uso normal no las pide y no las va a pedir. Ver §3.5 para el único caso donde podrían aparecer
- **Carpetas o jerarquía** — es un portapapeles, no un Drive
- **CRDT** — el aviso de conflicto cubre el caso real
- **Vista previa de archivos** — renderizar contenido de desconocidos es superficie de ataque pura, y contradice el modelo de descarga automática
- **Móvil como cliente principal** — que funcione, pero no se diseña para él

---

## 9. Abuso y límites

Un servicio anónimo que acepta archivos es imán de malware, phishing y contenido
ilegal. Llegan avisos de abuso y quejas del proveedor, y consume tiempo real.

El diseño protege bastante: archivos borrados al confirmar recepción, sin URLs
públicas persistentes compartibles fuera, y salas que requieren aprobación. **Un
archivo que vive 30 segundos y exige aprobación previa no sirve para alojar
nada.** Las salas fijadas no cambian esto, porque el tratamiento de archivos es
idéntico.

Desde el día uno, no después:

| Límite | Valor inicial |
|---|---|
| Salas por IP | 10 / hora |
| Salas fijadas por IP | 3 |
| Tamaño por archivo | 1 GB |
| Almacenamiento por sala | 1 GB (texto, pegadas y archivos juntos) |
| Ancho de banda por sala | 5 GB |
| Texto por sala | 8 MB |
| Salas concurrentes | 500 |

---

## 10. Modelo comercial

**Publicidad: no.** Las sesiones duran segundos, la audiencia son devs (60-70%
con bloqueador), y con 10 000 sesiones diarias serían unos cientos de dólares al
mes. Pero el problema no es el ingreso: la gente pega ahí código de trabajo y
configuración. Meter JavaScript de terceros en esa página mata la propuesta de
valor y cierra el mercado que sí paga.

**Núcleo abierto. La frontera no es "gratis contra pago" sino "efímero contra
gobernado":**

- **Servidor abierto y gratis.** Es el canal de distribución, y para autohospedaje es lo único que la gente acepta
- **Versión alojada gratis y generosa.** Casi no cuesta; es el escaparate. Experiencia completa, sin cuentas
- **Licencia empresarial.** El mismo binario dentro de su red, con su certificado, más SSO, registro de auditoría de quién movió qué, y retención configurable

Ese último punto es la clave: la auditoría convierte la herramienta de "rodeo a
un control de seguridad" en "canal aprobado con trazabilidad". Es la diferencia
entre que la prohíban y que la adopten.

Las salas fijadas son la candidata natural a límite de cuota en la versión
alojada, si alguna vez hace falta monetizar ahí.

---

## 11. Orden de construcción

Cada etapa es entregable por sí sola.

1. **Sala, código, texto sincronizado por WS.** Sin archivos, sin aprobación. Ya resuelve el problema original
2. **Aprobación del dueño y huella.** Aquí ya es defendible ponerlo público
3. **Archivos con subida por trozos y descarga manual**
4. **Recepción automática** con Service Worker y conteo de referencias
5. **CLI e historial**
6. **SQLite para el índice**, que permite desplegar sin matar sesiones vivas
7. **Salas fijadas**, que dependen de la etapa 6

Abrir el código desde el paso 1, no al final. Un proyecto así vive de que alguien
lo encuentre y lo autohospede, y eso no pasa si aparece terminado y cerrado.

---

## 12. Dominio

**`cloudnt.org`**

`.org` no está en la lista HSTS precargada, a diferencia de `.app` o `.dev`.
Como la recepción automática exige contexto seguro, hay que **forzar HTTPS
explícitamente**: redirección 301 desde HTTP y cabecera
`Strict-Transport-Security` con `max-age` largo, `includeSubDomains` y
`preload`. Sirviendo detrás de Cloudflare o Caddy es configuración, no
desarrollo. Vale la pena enviar el dominio a la lista de precarga HSTS una vez
estable.

El código va en el path (`cloudnt.org/f4k2`), no en subdominio. Con eso el
Service Worker vive en un origen único y no se acumulan registros huérfanos por
sala.

Como consecuencia, **la portada se indexa y las salas no**. El HTML es el mismo
para todas las rutas, así que el `noindex` no puede vivir en un `<meta>`: el
servidor añade `X-Robots-Tag: noindex, nofollow` a todo lo que no sea `/`, y el
`robots.txt` sólo permite la raíz. Los metadatos de la portada —título,
descripción, canónica, Open Graph, JSON-LD— son los de una herramienta, no los
de un pastebin: describen para qué sirve, no lo que alguien pegó.

Pendiente antes de publicar el CLI: verificar que `cloudnt` esté libre en npm y
que no haya binario homónimo en Homebrew. Si npm está tomado, `@cloudnt/cli`
resuelve sin tocar la marca.

---

## 13. Decisiones pendientes

- Diccionario de la huella: ¿palabras en español, en inglés, o neutras entre ambos?
- Frase de recuperación de salas fijadas: ¿4 palabras del mismo diccionario de la huella, o BIP39?
- Formato del registro de auditoría empresarial: ¿syslog, JSON por línea, webhook?
- ¿Las salas fijadas conservan el historial de texto completo, o solo el estado actual? Afecta al tamaño de la base y a la promesa de privacidad
- ¿Se permite fijar una sala que ya tiene miembros aprobados, o solo al crearla? Fijar después cambia retroactivamente lo que los presentes creían que iba a pasar con su contenido
