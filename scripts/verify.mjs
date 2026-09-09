import { spawn } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (npmCli === undefined) throw new Error("npm_execpath is required to run verification");

const steps = ["format:check", "lint", "typecheck", "build", "test", "audit"];
for (const step of steps) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, "run", step], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    process.exitCode = typeof code === "number" ? code : 1;
    break;
  }
}
