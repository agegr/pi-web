import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";

const outputFile = process.argv[3] || "port.txt";
const mode = process.argv[2];
if (mode === "parent") {
  const child = spawn(process.execPath, [import.meta.filename, "server", outputFile], { stdio: "inherit" });
  console.log(`parent:${process.pid} child:${child.pid}`);
  setInterval(() => {}, 1000);
} else if (mode === "server") {
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.end("ready");
  });
  server.listen(0, "127.0.0.1", () => {
    writeFileSync(outputFile, String(server.address().port));
    console.log(`listening:${server.address().port}`);
    console.error("stderr:ready");
    console.log(`password:${process.env.PI_WEB_PASSWORD ?? "absent"}`);
  });
} else if (mode === "ignore") {
  process.on("SIGTERM", () => {});
  console.log("ignoring-term");
  setInterval(() => {}, 1000);
} else if (mode === "flood") {
  console.log("x".repeat(400_000));
  setInterval(() => {}, 1000);
} else {
  setInterval(() => {}, 1000);
}
