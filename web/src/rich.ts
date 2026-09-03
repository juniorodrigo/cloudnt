import DOMPurify from "dompurify";

/*
 * The editor content is written by other members of the room and arrives over
 * the socket, so every string that reaches the DOM passes through here first.
 */

const TAGS = [
	"p",
	"div",
	"br",
	"b",
	"strong",
	"i",
	"em",
	"u",
	"s",
	"code",
	"pre",
	"blockquote",
	"ul",
	"ol",
	"li",
	"a",
	"img",
];

/**
 * `src` is deliberately absent: an embedded image names the room file it came
 * from and the client resolves it against a local blob, so a document can never
 * make someone else's browser fetch a remote address.
 */
const ATTRS = ["href", "alt", "data-file"];

export function sanitize(html: string): string {
	const clean = DOMPurify.sanitize(html, {
		ALLOWED_TAGS: TAGS,
		ALLOWED_ATTR: ATTRS,
		RETURN_DOM_FRAGMENT: true,
	});
	for (const img of clean.querySelectorAll("img")) {
		if (!img.getAttribute("data-file")) img.remove();
	}
	for (const link of clean.querySelectorAll("a")) {
		link.setAttribute("target", "_blank");
		link.setAttribute("rel", "noreferrer noopener");
	}
	const host = document.createElement("div");
	host.append(clean);
	return host.innerHTML;
}

/** Strips the blob URLs the client painted in, so they never reach the server. */
export function serialize(el: HTMLElement): string {
	const clone = el.cloneNode(true) as HTMLElement;
	for (const img of clone.querySelectorAll("img")) img.removeAttribute("src");
	const html = sanitize(clone.innerHTML);
	// An editor emptied by hand keeps a <br>, which the room would store and be
	// charged for.
	return isEmpty(html) ? "" : html;
}

export function imageTag(fileId: string, name: string): string {
	const host = document.createElement("div");
	const img = document.createElement("img");
	img.setAttribute("data-file", fileId);
	img.setAttribute("alt", name);
	host.append(img);
	return host.innerHTML;
}

/**
 * What every plain-text consumer reads: the clipboard, the .txt download and
 * the entry previews. An image becomes its file name, which is the only part of
 * it that survives as text.
 */
export function toPlain(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	for (const img of doc.querySelectorAll("img")) {
		// A preview is cut wherever the character count ran out, so the name may
		// have been left behind with the rest of the tag.
		const name = img.getAttribute("alt") || img.getAttribute("data-file");
		img.replaceWith(name ? `[${name}]` : "");
	}
	for (const br of doc.querySelectorAll("br")) br.replaceWith("\n");
	// Both sides, or a block that follows inline text runs straight into it.
	for (const block of doc.querySelectorAll("p, div, li, blockquote, pre")) {
		block.before("\n");
		block.append("\n");
	}
	return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** A contenteditable left alone still holds a <br>, which is not content. */
export const isEmpty = (html: string): boolean => toPlain(html) === "";
