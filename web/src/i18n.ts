import { useEffect, useState } from "preact/hooks";
import { savedLang, saveLang } from "./store.ts";
import type { IconName } from "./icons.tsx";

type Feature = { icon: IconName; value: string; label: string; body: string };

export type Lang = "es" | "en";

const es = {
	langName: "Español",
	otherLang: "English",

	justNow: "ahora",
	ago: (value: string) => `hace ${value}`,

	app: {
		title: "cloudnt · portapapeles compartido entre máquinas",
		badCode: "Ese código no es válido.",
		noServer: "No se pudo contactar con el servidor.",
		noRoom: "Esa sala ya no existe.",
		noCreate: "No se pudo crear la sala.",
		opening: "Un momento...",
		netError: "error de red",
		charOf: (index: number, total: number) => `Carácter ${index} de ${total}`,
	},

	home: {
		create: "Crear una sala",
		creating: "Creando…",
		chip: "Portapapeles efímero",
		headline: "Pega donde no se puede",
		lead: "Cinco caracteres en la otra pantalla y lo que copiaste cruza. Sin cuentas, sin instalar nada.",
		specCode: "Código fácil",
		specCodeValue: "5 caracteres",
		specWipe: "Sesión de hasta",
		specWipeValue: "24 h max",
		specFiles: "Archivos",
		specFilesValue: "hasta 1 GB",
		joinLabel: "¿Ya tienes un código? Tecléalo aquí.",
		createNote: "Empieza aquí si esta es la máquina que tiene el texto.",
		recents: "Salas recientes en este navegador",
		mine: "tuya",
		guest: "invitado",
		stepsTitle: "Tres pasos",
		stepsLead: "Todo el flujo en pocos segundos, el tiempo que tardarías en teclear una tecla a mano.",
		steps: [
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
		],
		featuresTitle: "Lo que hace la sala por ti",
		featuresLead: "Garantías y límites con los que puedes contar.",
		wipeTag: "2 h · 24 h",
		wipeTitle: "Se borra sola",
		wipeBody: "Dos horas sin actividad y la sala desaparece con todo lo que llevaba dentro. Nunca más de veinticuatro. No hay botón de guardar porque no hay dónde guardar.",
		approveTag: "Huella de dos palabras",
		approveTitle: "Nadie entra sin que lo apruebes",
		approveBody: "Cada intento muestra un par de palabras. Apruebas el que aparece en tu pantalla. Si alguien prueba códigos al azar, el tuyo rota antes de que acierte.",
		features: [
			{
				icon: "file",
				value: "1 GB",
				label: "por archivo",
				body: "Viaja en trozos de 5 MB y antes de seguir pregunta cuáles llegaron, así que un corte de red retoma donde iba en vez de empezar de cero.",
			},
			{
				icon: "layers",
				value: "1 GB",
				label: "para toda la sala",
				body: "Un solo presupuesto para el texto, los bloques y los archivos, y abajo se ve cuánto llevas. No hay cuenta de archivos que llevar: sube los que quieras mientras quepan. El volcado de logs, el dump y los tres certificados van al mismo sitio.",
			},
			{
				icon: "history",
				value: "sin tope",
				label: "bloques guardados",
				body: "Pegar algo nuevo no borra lo anterior: la sala los guarda todos mientras quepan en el gigabyte, y puedes volver a cualquiera.",
			},
			{
				icon: "devices",
				value: "16",
				label: "equipos a la vez",
				body: "El bastión, tu portátil y la VM del cliente sobre el mismo texto, sin repetir el trasvase una vez por máquina.",
			},
		] as Feature[],
		faqTitle: "Preguntas",
		faqLead: "Lo que conviene saber antes de mover algo por aquí.",
		faq: [
			{
				q: "¿Hay que instalar algo en el servidor?",
				a: "No. Ni agente, ni extensión, ni cuenta. La máquina remota sólo necesita un navegador que alcance este servidor; la app pesa lo justo para cargar con una red mala.",
			},
			{
				q: "¿Y los archivos?",
				a: "Ya están. Los que quieras, dentro del mismo gigabyte que comparten con el texto y los bloques. La subida va por trozos y es reanudable: si la sesión se cae a mitad de un binario grande, al volver continúa por donde iba.",
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
		],
		repoTag: "Código abierto",
		repoBody: "Léelo antes de confiarle un secreto, o levántalo en tu propio servidor para que nada salga de tu red.",
		footerNote: "Lo que pasa por una sala dura lo que dura la sala.",
	},

	waiting: {
		rejectedTitle: "Acceso rechazado",
		rejectedPre: "El dueño de la sala ",
		rejectedPost: " no aprobó este dispositivo. Si fue un error, puede deshacerlo durante 30 segundos y entrarías solo.",
		waitingPre: "Esperando aprobación para la sala ",
		hint: "Comprueba que estas dos palabras son las mismas que aparecen en la pantalla donde creaste la sala, y aprueba desde allí.",
		back: "Volver",
	},

	room: {
		opening: "Abriendo la sala...",
		kicked: "El dueño te sacó de la sala.",
		expired: "La sala expiró.",
		closed: "El dueño cerró la sala.",

		home: "Volver a la portada",
		homeTip: "Volver a la portada · la sala sigue abierta",
		copyLink: "Copiar el enlace de la sala",
		copy: "Copiar",
		copyTip: "Alt+C · copia el texto al portapapeles de esta máquina",
		pin: "Guardar",
		pinTip: "Alt+N · guarda lo que hay en el editor como un bloque aparte",
		pinEmpty: "No hay nada escrito que guardar",
		pinOpen: "Este bloque ya está guardado: lo que escribes en él se guarda solo",
		duplicate: "Duplicar",
		duplicateTip: "Este bloque es de solo lectura: pasa su texto al borrador para poder cambiarlo",
		new: "Nuevo",
		newTip: "Deja el editor en blanco. Lo que hubiera se guarda como bloque antes de irse",
		newEmpty: "El editor ya está vacío",
		draftDoc: "Borrador compartido",
		editingBlock: (age: string) => `Bloque · ${age}`,
		lockedBlock: "solo lectura",
		closeBlock: "Volver al borrador compartido",
		openTag: "abierto",
		download: "Descargar",
		downloadTip: "Alt+S · descarga el texto como archivo .txt",

		copied: "Copiado al portapapeles",
		noClipboardSelected: "Sin permiso de portapapeles: el texto quedó seleccionado, pulsa Ctrl+C",
		noClipboard: "Sin permiso de portapapeles",
		fullPin: "La sala está llena: borra algo antes de guardar otro bloque",
		fullUpload: "La sala está llena: borra algo para subir más",
		pinned: "Guardado como bloque",
		blockCopied: "Bloque copiado",
		allCopied: "Todo copiado al portapapeles",
		linkCopied: "Enlace copiado",
		uploadCut: "se cortó la subida",
		uploadFailed: (name: string, reason: string) => `${name}: ${reason}`,

		devices: "Dispositivos en la sala",
		waitingApproval: "Esperando aprobación",
		approve: "Aprobar",
		reject: "Rechazar",
		rejected: (fingerprint: string) => `Rechazado ${fingerprint}`,
		deviceCount: (n: number) => `Dispositivos (${n})`,
		you: "tú",
		owner: "dueño",
		kick: (fingerprint: string) => `Expulsar a ${fingerprint}`,

		settings: "Ajustes",
		thisDevice: "Este dispositivo",
		language: "Idioma",
		access: "Acceso",
		autoApproveOn: (left: string) => `Auto-aprobar: ${left}`,
		autoApproveOff: "Auto-aprobar 5 min",
		autoApproveEnabled: "Auto-aprobar activo 5 min",
		autoApproveDisabled: "Auto-aprobar desactivado",
		rotate: "Cambiar el código",
		rotated: "Código rotado",
		danger: "Zona de riesgo",
		wipe: "Vaciar el contenido",
		wipeTitle: "¿Vaciar la sala?",
		wipeBody: "Se borran el texto y los bloques de texto de todos los que estén dentro. Los archivos se quedan. No se puede deshacer.",
		wipeLabel: "Vaciar",
		wiped: "Sala vaciada",
		close: "Cerrar la sala",
		closeTitle: "¿Cerrar la sala?",
		closeBody: "La sala desaparece ahora mismo con el texto, los bloques de texto y los archivos, y todos los conectados salen. No se puede deshacer.",

		conflictTitle: "Alguien más editó el texto.",
		conflictBody: "Tu versión no se ha perdido: elige cuál se queda.",
		takeTheirs: "Traer la nueva",
		keepMine: "Conservar la mía",
		fullTitle: "La sala está llena.",
		fullBody: (limit: string) => `${limit} entre el texto, los bloques de texto y los archivos. Puedes seguir leyéndola y descargando; para enviar algo más, borra lo que ya no necesites.`,
		fullShort: "La sala está llena",
		expiresIn: (left: string) => `Esta sala se borra en ${left}.`,
		expiresNow: (left: string) => `Quedan ${left}: la sala y todo lo que hay dentro se borran.`,
		keepAlive: "Mantener viva",

		editorLabel: "Contenido compartido de la sala",
		editorPlaceholder: "Pega aquí lo que quieras mover a la otra máquina.",
		formatting: "Formato",
		bold: "Negrita",
		italic: "Cursiva",
		strike: "Tachado",
		bullets: "Lista con viñetas",
		numbers: "Lista numerada",
		resizer: "Ancho del panel lateral",
		tabBlocks: "Bloques",
		tabFiles: "Archivos",
		newTag: "nuevo",
		copyAll: "Copiar todo",
		upload: "Subir archivo",
		emptyBlocks: "Cada vez que alguien pega algo distinto, lo anterior queda aquí como un bloque aparte. También puedes guardar el texto actual sin esperar a que lo reemplacen.",
		emptyFiles: "Arrastra un archivo a la sala o pulsa Subir. Se borran con ella.",
		copyBlock: "Copiar este bloque",
		openBlock: "Abrir en el editor",
		removeBlock: "Quitar este bloque",
		lockBlock: "Bloquear: nadie podrá cambiarlo",
		unlockBlock: "Desbloquear para poder cambiarlo",
		resume: "Reanudar",
		remove: "Quitar",
		dropHere: "Suelta para subirlo a la sala",

		online: "conectado",
		offline: "reconectando",
		usageLabel: "Espacio usado en la sala",
		usageTitle: (used: string, limit: string) => `${used} de ${limit} entre el texto, los bloques de texto y los archivos`,
		usageOf: (percent: string, limit: string) => `${percent} de ${limit}`,
		unsaved: "sin guardar",
		synced: "sincronizado",
		clock: (left: string) => `${left} sin actividad`,
		renewed: " · reiniciado",
		cancel: "Cancelar",
		undo: "Deshacer",
	},
};

const en: typeof es = {
	langName: "English",
	otherLang: "Español",

	justNow: "just now",
	ago: (value: string) => `${value} ago`,

	app: {
		title: "cloudnt · shared clipboard between machines",
		badCode: "That code is not valid.",
		noServer: "Could not reach the server.",
		noRoom: "That room is gone.",
		noCreate: "Could not create the room.",
		opening: "One moment...",
		netError: "network error",
		charOf: (index: number, total: number) => `Character ${index} of ${total}`,
	},

	home: {
		create: "Open a room",
		creating: "Opening…",
		chip: "Ephemeral clipboard",
		headline: "Paste where you can't",
		lead: "Five characters on the other screen and what you copied crosses over. No accounts, nothing to install.",
		specCode: "Easy to use",
		specCodeValue: "5 char code",
		specWipe: "Session wipes",
		specWipeValue: "24 h max",
		specFiles: "Files",
		specFilesValue: "up to 1 GB",
		joinLabel: "Got a code already? Type it here.",
		createNote: "Start here if this is the machine holding the text.",
		recents: "Recent rooms in this browser",
		mine: "yours",
		guest: "guest",
		stepsTitle: "Three steps",
		stepsLead: "The whole thing fits in the time it would take you to type a key by hand.",
		steps: [
			{
				title: "You open a room",
				body: "One click. Out comes a five-character code, with no vowels and no digits that get mixed up when you read them out loud.",
			},
			{
				title: "You type it on the other machine",
				body: "Five boxes, built for a remote keyboard with lag and someone else's layout. That machine is not in yet: it waits.",
			},
			{
				title: "You approve it by its fingerprint",
				body: "The waiting machine shows a pair of words and you see the same pair. If they don't match, it isn't who you think: turn it down.",
			},
		],
		featuresTitle: "What the room does for you",
		featuresLead: "Two guarantees that don't depend on you remembering anything, and the limits you can count on.",
		wipeTag: "2 h · 24 h",
		wipeTitle: "It wipes itself",
		wipeBody: "Two hours idle and the room disappears with everything it held. Never more than twenty-four. There is no save button because there is nowhere to save.",
		approveTag: "Two-word fingerprint",
		approveTitle: "Nobody gets in without your say-so",
		approveBody: "Every attempt shows a pair of words. You approve the one on your screen. If someone is guessing codes at random, yours rotates before they land it.",
		features: [
			{
				icon: "file",
				value: "1 GB",
				label: "per file",
				body: "It travels in 5 MB chunks and asks which ones landed before going on, so a dropped connection picks up where it was instead of starting over.",
			},
			{
				icon: "layers",
				value: "1 GB",
				label: "for the whole room",
				body:
					"One budget for the text, the blocks and the files, and the bottom shows how much you have used. There is no file count to keep track of: upload as many as fit. The log dump, the database dump and the three certificates all go to the same place.",
			},
			{
				icon: "history",
				value: "no cap",
				label: "blocks kept",
				body: "Pasting something new doesn't erase what was there: the room keeps every one of them while they fit in the gigabyte, and you can go back to any.",
			},
			{
				icon: "devices",
				value: "16",
				label: "machines at once",
				body: "The bastion, your laptop and the customer's VM on the same text, without repeating the handover once per machine.",
			},
		],
		faqTitle: "Questions",
		faqLead: "What is worth knowing before you move anything through here.",
		faq: [
			{
				q: "Do I have to install anything on the server?",
				a: "No. No agent, no extension, no account. The remote machine only needs a browser that can reach this server; the app is small enough to load over a bad link.",
			},
			{
				q: "What about files?",
				a: "They're here. As many as you like, inside the same gigabyte they share with the text and the blocks. The upload is chunked and resumable: if the session drops halfway through a large binary, it carries on where it was.",
			},
			{
				q: "Who can see what I paste?",
				a: "Whoever is in the room, and only the people you approve get in. The text lives on the server for as long as the room does, so treat it for what it is: a channel in transit, not a safe. For a long-lived secret, rotate it after you move it.",
			},
			{
				q: "My organisation blocks the clipboard on purpose. Does this get around that?",
				a: "Don't frame it that way. If there is a data-loss prevention policy, this channel is not the detour: it is traffic just as visible and it is still on you. cloudnt is for when the technical channel is missing, not for going around the person who put the control there.",
			},
			{
				q: "Can I run it myself?",
				a: "Yes. The code is open and the server is one process with its data folder beside it, no external database and no services to sign up for. If the material can't leave your network, put it inside your network.",
			},
		],
		repoTag: "Open source",
		repoBody: "Read it before you trust it with a secret, or run it on your own server so nothing leaves your network.",
		footerNote: "Whatever goes through a room lasts as long as the room.",
	},

	waiting: {
		rejectedTitle: "Access turned down",
		rejectedPre: "The owner of room ",
		rejectedPost: " did not approve this device. If it was a mistake, they can undo it for 30 seconds and you would get in on your own.",
		waitingPre: "Waiting for approval to join room ",
		hint: "Check that these two words are the same ones showing on the screen where you opened the room, and approve from there.",
		back: "Back",
	},

	room: {
		opening: "Opening the room...",
		kicked: "The owner removed you from the room.",
		expired: "The room expired.",
		closed: "The owner closed the room.",

		home: "Back to the landing page",
		homeTip: "Back to the landing page · the room stays open",
		copyLink: "Copy the room link",
		copy: "Copy",
		copyTip: "Alt+C · copies the text to this machine's clipboard",
		pin: "Save",
		pinTip: "Alt+N · saves what the editor holds as a block of its own",
		pinEmpty: "There is nothing written to save",
		pinOpen: "This block is already saved: what you write in it is kept on its own",
		duplicate: "Duplicate",
		duplicateTip: "This block is read-only: move its text to the draft to change it",
		new: "New",
		newTip: "Leaves the editor blank. Whatever was there is saved as a block first",
		newEmpty: "The editor is already empty",
		draftDoc: "Shared draft",
		editingBlock: (age: string) => `Block · ${age}`,
		lockedBlock: "read-only",
		closeBlock: "Back to the shared draft",
		openTag: "open",
		download: "Download",
		downloadTip: "Alt+S · downloads the text as a .txt file",

		copied: "Copied to the clipboard",
		noClipboardSelected: "No clipboard permission: the text is selected, press Ctrl+C",
		noClipboard: "No clipboard permission",
		fullPin: "The room is full: delete something before saving another block",
		fullUpload: "The room is full: delete something to upload more",
		pinned: "Saved as a block",
		blockCopied: "Block copied",
		allCopied: "Everything copied to the clipboard",
		linkCopied: "Link copied",
		uploadCut: "the upload was cut off",
		uploadFailed: (name: string, reason: string) => `${name}: ${reason}`,

		devices: "Devices in the room",
		waitingApproval: "Waiting for approval",
		approve: "Approve",
		reject: "Turn down",
		rejected: (fingerprint: string) => `Turned down ${fingerprint}`,
		deviceCount: (n: number) => `Devices (${n})`,
		you: "you",
		owner: "owner",
		kick: (fingerprint: string) => `Remove ${fingerprint}`,

		settings: "Settings",
		thisDevice: "This device",
		language: "Language",
		access: "Access",
		autoApproveOn: (left: string) => `Auto-approve: ${left}`,
		autoApproveOff: "Auto-approve for 5 min",
		autoApproveEnabled: "Auto-approve on for 5 min",
		autoApproveDisabled: "Auto-approve off",
		rotate: "Change the code",
		rotated: "Code rotated",
		danger: "Danger zone",
		wipe: "Wipe the contents",
		wipeTitle: "Wipe the room?",
		wipeBody: "The draft and the blocks are deleted for everyone inside. The files stay. This cannot be undone.",
		wipeLabel: "Wipe",
		wiped: "Room wiped",
		close: "Close the room",
		closeTitle: "Close the room?",
		closeBody: "The room disappears right now along with the draft, the blocks and the files, and everyone connected is dropped. This cannot be undone.",

		conflictTitle: "Someone else edited the text.",
		conflictBody: "Your version is not lost: pick which one stays.",
		takeTheirs: "Take the new one",
		keepMine: "Keep mine",
		fullTitle: "The room is full.",
		fullBody: (limit: string) => `${limit} across the draft, the blocks and the files. You can still read it and download; to send anything more, delete what you no longer need.`,
		fullShort: "The room is full",
		expiresIn: (left: string) => `This room is wiped in ${left}.`,
		expiresNow: (left: string) => `${left} left: the room and everything in it get wiped.`,
		keepAlive: "Keep it alive",

		editorLabel: "Shared room contents",
		editorPlaceholder: "Paste here whatever you want to move to the other machine.",
		formatting: "Formatting",
		bold: "Bold",
		italic: "Italic",
		strike: "Strikethrough",
		bullets: "Bulleted list",
		numbers: "Numbered list",
		resizer: "Side panel width",
		tabBlocks: "Blocks",
		tabFiles: "Files",
		newTag: "new",
		copyAll: "Copy everything",
		upload: "Upload a file",
		emptyBlocks: "Every time someone pastes something different, what was there stays here as a block of its own. You can also save the current text without waiting for it to be replaced.",
		emptyFiles: "Drag a file onto the room or press Upload. They go when it goes.",
		copyBlock: "Copy this block",
		openBlock: "Open it in the editor",
		removeBlock: "Remove this block",
		lockBlock: "Lock it: nobody will be able to change it",
		unlockBlock: "Unlock it so it can be changed",
		resume: "Resume",
		remove: "Remove",
		dropHere: "Drop to upload it to the room",

		online: "connected",
		offline: "reconnecting",
		usageLabel: "Space used in the room",
		usageTitle: (used: string, limit: string) => `${used} of ${limit} across the draft, the blocks and the files`,
		usageOf: (percent: string, limit: string) => `${percent} of ${limit}`,
		unsaved: "unsaved",
		synced: "synced",
		clock: (left: string) => `wiped in ${left} of inactivity`,
		renewed: " · reset",
		cancel: "Cancel",
		undo: "Undo",
	},
};

const DICTS = { es, en };

/**
 * The stored choice wins; without one the browser decides. Anyone whose browser
 * is not Spanish gets English on the first load rather than a wall of prose
 * they have to translate before they find the selector.
 */
let current: Lang = savedLang() ?? (navigator.language.toLowerCase().startsWith("es") ? "es" : "en");

document.documentElement.lang = current;

const listeners = new Set<() => void>();

export const currentLang = (): Lang => current;

/** For modules that run outside a component, like the formatters. */
export const strings = (): typeof es => DICTS[current];

export function setLang(next: Lang): void {
	current = next;
	saveLang(next);
	document.documentElement.lang = next;
	for (const notify of listeners) notify();
}

/** Subscribing rather than a context: every screen needs it, none nest. */
export function useT(): typeof es {
	const [, bump] = useState(0);
	useEffect(() => {
		const notify = () => bump((n) => n + 1);
		listeners.add(notify);
		return () => void listeners.delete(notify);
	}, []);
	return DICTS[current];
}
