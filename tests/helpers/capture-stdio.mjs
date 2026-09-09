import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const capturePath = process.argv[2];
const command = process.argv[3];
const args = process.argv.slice(4);
if (capturePath === undefined || command === undefined) throw new Error("capture path and command are required");

const child = spawn(command, args, { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
process.stdin.pipe(child.stdin);
child.stdout.on("data", (chunk) => {
  appendFileSync(capturePath, chunk);
  process.stdout.write(chunk);
});
child.stderr.pipe(process.stderr);
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.once("error", () => {
  process.exitCode = 1;
});
child.once("close", (code) => {
  process.exitCode = code ?? 1;
});
