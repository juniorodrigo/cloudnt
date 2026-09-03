/*
 * Drawn here rather than pulled from a pack: spec §6.1 forbids external assets,
 * and a handful of paths costs less than any icon dependency would.
 */

/* Stroked at 1.7 so they read as the same hand as the cloud in the wordmark. */
const LINE: Record<string, string> = {
	clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.2V12l3.2 1.9",
	shield: "M12 3 5.2 5.9v5.4c0 4.1 2.9 7.9 6.8 9.2 3.9-1.3 6.8-5.1 6.8-9.2V5.9L12 3ZM9.1 11.9l2 2 3.8-4",
	file: "M13.6 3H7.4A2.4 2.4 0 0 0 5 5.4v13.2A2.4 2.4 0 0 0 7.4 21h9.2a2.4 2.4 0 0 0 2.4-2.4V8.4L13.6 3ZM13.6 3v5.4H19M12 17.5v-6M9.6 13.9 12 11.5l2.4 2.4",
	layers: "m12 3 8.4 4.6L12 12.2 3.6 7.6 12 3ZM3.6 12.2 12 16.8l8.4-4.6M3.6 16.6 12 21.2l8.4-4.6",
	history: "M3.6 12a8.4 8.4 0 1 0 2.5-6M3.6 4.8v4.8h4.8M12 8v4.4l3.2 1.9",
	devices: "M4 5.4h16v9.2H4zM9.4 19h5.2M12 14.6V19",
	settings:
		"M4 7.5h7M15 7.5h5M4 16.5h4M12 16.5h8M13 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM10 14.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
	copy: "M9.6 7h8A2.4 2.4 0 0 1 20 9.4v8a2.4 2.4 0 0 1-2.4 2.4h-8A2.4 2.4 0 0 1 7.2 17.4v-8A2.4 2.4 0 0 1 9.6 7ZM4.6 15A2.4 2.4 0 0 1 4 13.4v-8A2.4 2.4 0 0 1 6.4 3h8A2.4 2.4 0 0 1 16 3.6",
	pin: "M6.8 3.6h10.4v16.8L12 16.4l-5.2 4V3.6Z",
	lock: "M6.4 10.4h11.2a1.4 1.4 0 0 1 1.4 1.4v7.2a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 19V11.8a1.4 1.4 0 0 1 1.4-1.4ZM8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8",
	unlock: "M6.4 10.4h11.2a1.4 1.4 0 0 1 1.4 1.4v7.2a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 19V11.8a1.4 1.4 0 0 1 1.4-1.4ZM8.4 10.4V7.6a3.6 3.6 0 0 1 7-1.2",
	download: "M12 3.6v11.8M7.8 11.2 12 15.4l4.2-4.2M4.6 20.4h14.8",
	trash: "M4.6 6.6h14.8M9.6 6.6V4.9a1.3 1.3 0 0 1 1.3-1.3h2.2a1.3 1.3 0 0 1 1.3 1.3v1.7M6.6 6.6l.9 12.2a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l.9-12.2",
	plus: "M12 5v14M5 12h14",
	close: "M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6",
	home: "m3.6 9.6 8.4-6.6 8.4 6.6v10.2a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V9.6ZM9.6 21.6V13.8h4.8v7.8",
	globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.3 9.6h17.4M3.3 14.4h17.4M12 3a13.5 13.5 0 0 0 0 18 13.5 13.5 0 0 0 0-18Z",
};

const GITHUB =
	"M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z";

export type IconName = keyof typeof LINE | "github";

type Props = {
	name: IconName;
	class?: string;
};

export function Icon({ name, class: className }: Props) {
	const github = name === "github";
	return (
		<svg
			class={className ? `icon ${className}` : "icon"}
			viewBox="0 0 24 24"
			fill={github ? "currentColor" : "none"}
			stroke={github ? "none" : "currentColor"}
			stroke-width="1.7"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d={github ? GITHUB : LINE[name]} />
		</svg>
	);
}
