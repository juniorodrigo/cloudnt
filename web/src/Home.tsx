import { useState } from "preact/hooks";
import { CodeInput } from "./CodeInput.tsx";
import { recentRooms, type SavedRoom } from "./store.ts";
import { formatAge } from "./format.ts";
import { Logo } from "./Logo.tsx";
import { Icon, type IconName } from "./icons.tsx";

type Props = {
	initialCode?: string;
	onEnter: (code: string) => void;
	onCreate: () => Promise<void>;
	error?: string;
};

const REPO = "https://github.com/juniorodrigo/cloudnt";

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

const FEATURES: { icon: IconName; value: string; label: string; body: string }[] = [
	{
		icon: "file",
		value: "2 GB",
		label: "por archivo",
		body: "Viaja en trozos de 5 MB y antes de seguir pregunta cuáles llegaron, así que un corte de red retoma donde iba en vez de empezar de cero.",
	},
	{
		icon: "layers",
		value: "20",
		label: "archivos por sala",
		body: "Hasta 5 GB en total. El volcado de logs, el dump y los tres certificados caben en el mismo sitio.",
	},
	{
		icon: "history",
		value: "10",
		label: "pegados en el historial",
		body: "Pegar algo nuevo no borra lo anterior: la sala guarda los últimos diez y puedes volver a cualquiera.",
	},
	{
		icon: "devices",
		value: "16",
		label: "equipos a la vez",
		body: "El bastión, tu portátil y la VM del cliente sobre el mismo texto, sin repetir el trasvase una vez por máquina.",
	},
];

const FAQ = [
	{
		q: "¿Hay que instalar algo en el servidor?",
		a: "No. Ni agente, ni extensión, ni cuenta. La máquina remota sólo necesita un navegador que alcance este servidor; la app pesa lo justo para cargar con una red mala.",
	},
	{
		q: "¿Y los archivos?",
		a: "Ya están. Hasta 2 GB por archivo y 20 por sala. La subida va por trozos y es reanudable: si la sesión se cae a mitad de un binario grande, al volver continúa por donde iba.",
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
		q: "¿Puedo levantarlo yo?",
		a: "Sí. El código es abierto y el servidor es un proceso con su carpeta de datos al lado, sin base de datos externa ni servicios que contratar. Si el material no puede salir de tu red, ponlo dentro de tu red.",
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
					<Logo />
					<span class="nav-spacer" />
					<a class="nav-link" href={REPO} target="_blank" rel="noreferrer noopener">
						<Icon name="github" />
						GitHub
					</a>
					<button type="button" class="btn btn-primary btn-sm" disabled={creating} onClick={create}>
						{creating ? "Creando…" : "Crear una sala"}
					</button>
				</div>
			</nav>

			<header class="hero">
				<div class="hero-glow" aria-hidden="true" />
				<div class="wrap">
					<div class="hero-copy">
						<span class="chip">
							<span class="chip-dot" aria-hidden="true" />
							Portapapeles efímero
						</span>
						<h1 class="display-xxl">
							Pega donde no se puede pegar<span class="hero-accent">.</span>
						</h1>
						<p class="hero-lead">
							Cinco caracteres en la otra pantalla y lo que copiaste cruza. Sin cuentas, sin instalar nada.
						</p>
						<dl class="hero-specs">
							<div>
								<dt>Código</dt>
								<dd>5 caracteres</dd>
							</div>
							<div>
								<dt>Se borra</dt>
								<dd>2 h sin uso</dd>
							</div>
							<div>
								<dt>Archivos</dt>
								<dd>hasta 2 GB</dd>
							</div>
						</dl>
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
							<button type="button" class="btn btn-primary btn-lg" disabled={creating} onClick={create}>
								{creating ? "Creando…" : "Crear una sala"}
							</button>
							<span class="join-alt-note">Empieza aquí si esta es la máquina que tiene el texto.</span>
						</div>

						{recents.length > 0 ? (
							<div class="recents">
								<h2>Salas recientes en este navegador</h2>
								{recents.map((room) => (
									<button key={room.token} type="button" class="recent-row" onClick={() => onEnter(room.code)}>
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
						<h2 class="display-lg">Tres pasos</h2>
						<p>Todo el flujo cabe en el tiempo que tardarías en teclear una clave a mano.</p>
					</div>
					<ol class="steps">
						{STEPS.map((step, index) => (
							<li key={step.title} class="step">
								<span class="step-n">{String(index + 1).padStart(2, "0")}</span>
								<h3>{step.title}</h3>
								<p>{step.body}</p>
							</li>
						))}
					</ol>
				</div>
			</section>

			<section class="section">
				<div class="wrap">
					<div class="section-head">
						<h2 class="display-lg">Lo que hace la sala por ti</h2>
						<p>Dos garantías que no dependen de que te acuerdes de nada, y los límites con los que puedes contar.</p>
					</div>
					<div class="spotlights">
						<article class="spotlight spotlight-violet">
							<span class="spotlight-tag">
								<Icon name="clock" />
								2 h · 24 h
							</span>
							<h3>Se borra sola</h3>
							<p>
								Dos horas sin actividad y la sala desaparece con todo lo que llevaba dentro. Nunca más de veinticuatro. No
								hay botón de guardar porque no hay dónde guardar.
							</p>
						</article>
						<article class="spotlight spotlight-orange">
							<span class="spotlight-tag">
								<Icon name="shield" />
								Huella de dos palabras
							</span>
							<h3>Nadie entra sin que lo apruebes</h3>
							<p>
								Cada intento muestra un par de palabras. Apruebas el que aparece en tu pantalla. Si alguien prueba códigos
								al azar, el tuyo rota antes de que acierte.
							</p>
						</article>
					</div>
					<div class="features">
						{FEATURES.map((feature) => (
							<article key={feature.label} class="feature">
								<span class="feature-top">
									<span class="feature-value">{feature.value}</span>
									<Icon name={feature.icon} class="feature-icon" />
								</span>
								<span class="feature-label">{feature.label}</span>
								<p>{feature.body}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section class="section">
				<div class="wrap">
					<div class="section-head">
						<h2 class="display-lg">Preguntas</h2>
						<p>Lo que conviene saber antes de mover algo por aquí.</p>
					</div>
					<dl class="faq">
						{FAQ.map((item, index) => (
							<div key={item.q} class="faq-row">
								<dt>
									<span class="faq-n">{String(index + 1).padStart(2, "0")}</span>
									{item.q}
								</dt>
								<dd>{item.a}</dd>
							</div>
						))}
					</dl>
				</div>
			</section>

			<section class="section section-tight">
				<div class="wrap">
					<a class="repo-card" href={REPO} target="_blank" rel="noreferrer noopener">
						<span class="repo-tag">Código abierto</span>
						<span class="repo-name">github.com/juniorodrigo/cloudnt</span>
						<span class="repo-body">
							Léelo antes de confiarle un secreto, o levántalo en tu propio servidor para que nada salga de tu red.
						</span>
						<Icon name="github" class="repo-mark" />
					</a>
				</div>
			</section>

			<footer class="site-footer">
				<div class="wrap">
					<Logo />
					<span class="nav-spacer" />
					<a class="nav-link" href={REPO} target="_blank" rel="noreferrer noopener">
						<Icon name="github" />
						GitHub
					</a>
				</div>
			</footer>
		</div>
	);
}
