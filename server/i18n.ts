export type Lang = "es" | "en";

const es = {
  unauthorized: "no autorizado",
  noSocket: "no se pudo abrir el WebSocket",
  badRequest: "petición inválida",
  unknownRoute: "ruta desconocida",
  notFound: "no encontrada",
  memberNotFound: "no encontrado",

  tooManyRooms: "demasiadas salas creadas desde esta red, espera un rato",
  noRoomsLeft: "no hay salas libres en este momento",
  tooManyJoins: "demasiados intentos, espera un momento",
  badCode: "código inválido",
  noRoom: "esa sala no existe o ya expiró",
  roomGone: "esa sala ya no existe",
  roomCrowded: "la sala está llena",

  /** The figure lives in the footer meter; repeating it here would be one more
   *  place to forget when the limit moves. */
  full: "la sala está llena: borra algo para hacer sitio",
  textTooBig: "el texto supera el límite de la sala",
  nothingToSave: "no hay nada nuevo que guardar",
  blockGone: "ese bloque ya no está",
  blockLocked: "ese bloque está bloqueado",
  authorLocks: "solo quien lo creó o el dueño lo bloquea",

  ticketSpent: "ese enlace ya se usó o expiró",
  fileGone: "ese archivo ya no está",
  fileComplete: "ese archivo ya está completo",
  fileUploading: "el archivo todavía se está subiendo",
  tooManyFiles: "la sala ya tiene el máximo de archivos",
  tooFastFiles: "vas muy rápido subiendo archivos, espera un momento",
  overQuota: "la sala llegó a su límite de tráfico",
  noDisk: "no queda espacio, inténtalo más tarde",
  fileTooBig: "el archivo supera el límite de la sala",
  chunkOutOfRange: "trozo fuera de rango",
  missingChunks: "faltan trozos por subir",
  corrupt: "el archivo llegó corrupto, vuelve a subirlo",

  ownerOrAuthorRemoves: "solo quien lo subió o el dueño lo borra",
  ownerApproves: "solo el dueño aprueba",
  ownerRejects: "solo el dueño rechaza",
  ownerKicks: "solo el dueño expulsa",
  ownerRotates: "solo el dueño rota el código",
  ownerEnables: "solo el dueño lo activa",
  ownerCloses: "solo el dueño cierra la sala",
  requestGone: "esa solicitud ya no está disponible",
};

const en: typeof es = {
  unauthorized: "not authorised",
  noSocket: "the WebSocket could not be opened",
  badRequest: "invalid request",
  unknownRoute: "unknown route",
  notFound: "not found",
  memberNotFound: "not found",

  tooManyRooms: "too many rooms opened from this network, wait a while",
  noRoomsLeft: "no rooms available right now",
  tooManyJoins: "too many attempts, wait a moment",
  badCode: "invalid code",
  noRoom: "that room does not exist or has expired",
  roomGone: "that room no longer exists",
  roomCrowded: "the room is full",

  full: "the room is out of space: delete something to make room",
  textTooBig: "the text is over the room's limit",
  nothingToSave: "there is nothing new to save",
  blockGone: "that block is gone",
  blockLocked: "that block is locked",
  authorLocks: "only whoever created it or the owner can lock it",

  ticketSpent: "that link was already used or has expired",
  fileGone: "that file is gone",
  fileComplete: "that file is already complete",
  fileUploading: "the file is still uploading",
  tooManyFiles: "the room already holds the maximum number of files",
  tooFastFiles: "you are uploading too fast, wait a moment",
  overQuota: "the room reached its traffic limit",
  noDisk: "no space left, try again later",
  fileTooBig: "the file is over the room's limit",
  chunkOutOfRange: "chunk out of range",
  missingChunks: "some chunks are still missing",
  corrupt: "the file arrived corrupted, upload it again",

  ownerOrAuthorRemoves: "only the uploader or the owner can delete it",
  ownerApproves: "only the owner approves",
  ownerRejects: "only the owner rejects",
  ownerKicks: "only the owner removes people",
  ownerRotates: "only the owner rotates the code",
  ownerEnables: "only the owner turns it on",
  ownerCloses: "only the owner closes the room",
  requestGone: "that request is no longer available",
};

const DICTS = { es, en };

export const msg = (lang: Lang): typeof es => DICTS[lang];

/**
 * The client's own choice comes first: once someone uses the selector it stops
 * matching the browser, and these errors land in the same toasts as the rest of
 * the interface.
 */
export function langOf(req: Request): Lang {
  const chosen = req.headers.get("x-lang");
  if (chosen === "es" || chosen === "en") return chosen;
  return req.headers.get("accept-language")?.toLowerCase().startsWith("es") ? "es" : "en";
}
