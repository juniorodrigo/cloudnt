/**
 * Starts the server and the client together.
 *
 * Uses process.execPath instead of the name `bun`: task launchers spawn child
 * processes with a non-interactive shell that does not always have ~/.bun/bin
 * on PATH. It also pins the server port, because a PORT inherited from the
 * environment would make it fight Vite over the same socket.
 */
const API_PORT = Bun.env.CLOUDNT_API_PORT ?? "3000";

const children = [
  Bun.spawn({
    cmd: [process.execPath, "run", "--watch", "server/index.ts"],
    env: { ...process.env, PORT: API_PORT },
    stdio: ["inherit", "inherit", "inherit"],
  }),
  Bun.spawn({
    cmd: [process.execPath, "x", "vite"],
    env: { ...process.env, PORT: undefined },
    stdio: ["inherit", "inherit", "inherit"],
  }),
];

const stopAll = () => {
  for (const child of children) child.kill();
};

process.on("SIGINT", () => (stopAll(), process.exit(0)));
process.on("SIGTERM", () => (stopAll(), process.exit(0)));

await Promise.race(children.map((child) => child.exited));
stopAll();
