import { useState } from "preact/hooks";
import { CodeInput } from "./CodeInput.tsx";
import { recentRooms, type SavedRoom } from "./store.ts";
import { formatAge } from "./format.ts";

type Props = {
  initialCode?: string;
  onEnter: (code: string) => void;
  onCreate: () => Promise<void>;
  error?: string;
};

const SCENARIOS = [
  {
    title: "Consolas serie y VNC del proveedor",
    body: "La consola serie de EC2, Azure Bastion o el VNC que trae el panel: son píxeles. No hay portapapeles que compartir porque no hay canal, sólo una imagen.",
  },
  {
    title: "KVM, IPMI, iDRAC",
    body: "La BIOS por navegador. Teclear una dirección IPv6 o una clave de recuperación a mano, carácter a carácter, sabiendo que un fallo son diez minutos más.",
  },
  {
    title: "Saltos SSH sin transferencia",
    body: "Llegas al host por un bastión que reenvía la sesión y nada más. No hay scp, no hay montaje, y la clave que necesitas está en la otra pantalla.",
  },
  {
    title: "Dos equipos que no se ven",
    body: "El portátil de casa y la VM del cliente, en redes que no se alcanzan. Lo único que comparten es que ambos llegan a este servidor.",
  },
];

const STEPS = [
  {
    title: "Abres una sala",
    body: "Un clic. Sale un código de cinco caracteres, sin vocales ni dígitos que se confundan al dictarlos en voz alta.",
  },
  {
    title: "Lo tecleas en la otra máquina",
    body: "Cinco casillas, pensadas para un teclado remoto con lag y distribución ajena. Esa máquina no entra todavía: se queda esperando.",
  },
  {
    title: "Apruebas por su huella",
    body: "El equipo que espera muestra un par de palabras y tú ves el mismo par. Si no coinciden, no es quien crees: rechazas.",
  },
];

const FAQ = [
  {
    q: "¿Hay que instalar algo en el servidor?",
    a: "No. Ni agente, ni extensión, ni cuenta. La máquina remota sólo necesita un navegador que alcance este servidor; la app pesa lo justo para cargar con una red mala.",
  },
  {
    q: "¿Quién puede ver lo que pego?",
    a: "Quien esté en la sala, y sólo entra quien tú apruebes. El texto vive en el servidor mientras la sala existe, así que trátalo como lo que es: un canal de tránsito, no una caja fuerte. Para un secreto de larga vida, rótalo después de moverlo.",
  },
  {
    q: "Mi organización bloquea el portapapeles a propósito. ¿Esto lo esquiva?",
    a: "No lo plantees así. Si existe una política de prevención de fuga de datos, este canal no es el rodeo: es tráfico igual de visible y sigue siendo tu responsabilidad. cloudnt es para cuando falta el canal técnico, no para saltarse a quien puso el control.",
  },
  {
    q: "¿Y los archivos?",
    a: "Todavía no. Ahora mismo mueve texto: claves públicas, tokens, trazas de error, un bloque de YAML. La transferencia de archivos es lo siguiente.",
  },
];

export function Home({ initialCode, onEnter, onCreate, error }: Props) {
  const [creating, setCreating] = useState(false);
  const [recents] = useState<SavedRoom[]>(() => recentRooms());

  const create = async () => {
    setCreating(true);
    try {
      await onCreate();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div class="home">
      <nav class="nav">
        <div class="wrap">
          <span class="wordmark">cloudnt</span>
          <span class="nav-spacer" />
          <span class="nav-note">sin cuentas</span>
          <button type="button" class="btn btn-primary btn-sm" disabled={creating} onClick={create}>
            {creating ? "Creando…" : "Crear una sala"}
          </button>
        </div>
      </nav>

      <header class="hero">
        <div class="wrap">
          <div class="hero-copy">
            <span class="eyebrow">Portapapeles compartido y efímero</span>
            <h1 class="display-xxl">Pegar en la máquina donde no se puede pegar.</h1>
            <p class="hero-lead">
              Abres una sala, tecleas cinco caracteres en la otra pantalla y el texto cruza. Sin
              cuentas, sin instalar nada, sin agente en el servidor.
            </p>
          </div>

          <div class="join">
            <div class="join-label">¿Ya tienes un código? Tecléalo aquí.</div>
            <CodeInput initial={initialCode} onComplete={onEnter} invalid={Boolean(error)} />
            {error ? (
              <p class="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <div class="join-alt">
              <button
                type="button"
                class="btn btn-primary btn-lg"
                disabled={creating}
                onClick={create}
              >
                {creating ? "Creando…" : "Crear una sala"}
              </button>
              <span class="join-alt-note">Empieza aquí si esta es la máquina que tiene el texto.</span>
            </div>

            {recents.length > 0 ? (
              <div class="recents">
                <h2>Salas recientes en este navegador</h2>
                {recents.map((room) => (
                  <button
                    key={room.token}
                    type="button"
                    class="recent-row"
                    onClick={() => onEnter(room.code)}
                  >
                    <span class="recent-code">{room.code}</span>
                    <span class="recent-meta">
                      {room.role === "owner" ? "tuya" : "invitado"} · {formatAge(room.savedAt)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <h2 class="display-lg">Donde el portapapeles se acaba</h2>
            <p>
              Hay pantallas que ves pero con las que no puedes hablar. En todas, el texto termina
              cruzando a mano.
            </p>
          </div>
          <div class="grid">
            {SCENARIOS.map((item) => (
              <article key={item.title} class="card-tile">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <h2 class="display-lg">Tres pasos</h2>
            <p>Todo el flujo cabe en el tiempo que tardarías en teclear una clave a mano.</p>
          </div>
          <div class="steps">
            {STEPS.map((step, index) => (
              <article key={step.title} class="step">
                <span class="step-n">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap spotlights">
          <article class="spotlight spotlight-violet">
            <h3>Se borra sola</h3>
            <p>
              Dos horas sin actividad y la sala desaparece con todo lo que llevaba dentro. Nunca
              más de veinticuatro. No hay botón de guardar porque no hay dónde guardar.
            </p>
          </article>
          <article class="spotlight spotlight-orange">
            <h3>Nadie entra sin que lo apruebes</h3>
            <p>
              Cada intento muestra un par de palabras. Apruebas el que aparece en tu pantalla. Si
              alguien prueba códigos al azar, el tuyo rota antes de que acierte.
            </p>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <h2 class="display-lg">Preguntas</h2>
          </div>
          {FAQ.map((item) => (
            <div key={item.q} class="faq-row">
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <footer class="site-footer">
        <div class="wrap">
          <span class="wordmark">cloudnt</span>
          <p>
            Sin cuentas y sin rastro. Las salas caducan a las dos horas sin actividad y el
            contenido se borra con ellas.
          </p>
        </div>
      </footer>
    </div>
  );
}
