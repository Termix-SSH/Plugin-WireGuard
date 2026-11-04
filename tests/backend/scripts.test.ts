import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";
import { DUMP } from "./fixtures";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const hasBash = spawnSync("bash", ["--version"]).status === 0;

describe.skipIf(!hasBash)("generated scripts", () => {
  it("are valid bash", async () => {
    server = await startServer();
    server.ssh.replies.push({ match: "ONLY=", stdout: DUMP });
    const s = server;
    const create = {
      name: "wg1",
      address: "10.9.0.1/24, fd42::1/64",
      listenPort: 51821,
      endpoint: "vpn.example.com:51821",
      nat: true,
      forwarding: true,
      openFirewall: true,
      start: true,
    };
    const calls: Array<[string, string, unknown?]> = [
      ["GET", "/1/status"],
      ["POST", "/1/install"],
      ["GET", "/1/logs?lines=50"],
      ["GET", "/1/interfaces"],
      ["POST", "/1/interfaces", create],
      ["POST", "/1/interfaces", { ...create, nat: false, forwarding: false }],
      ["PUT", "/1/interfaces/wg0", { listenPort: 4000, endpoint: "a.b:1" }],
      ["DELETE", "/1/interfaces/wg0"],
      ["POST", "/1/interfaces/wg0/service/start"],
      ["POST", "/1/interfaces/wg0/service/restart"],
      ["POST", "/1/interfaces/wg0/service/enable"],
      ["GET", "/1/interfaces/wg0/config"],
      [
        "PUT",
        "/1/interfaces/wg0/config",
        { text: "[Interface]\nListenPort = 1\n" },
      ],
      ["GET", "/1/interfaces/wg0/clients"],
      ["POST", "/1/interfaces/wg0/clients", { name: "laptop" }],
      ["POST", "/1/interfaces/wg0/clients/phone/state", { enabled: false }],
      ["POST", "/1/interfaces/wg0/clients/phone/rotate"],
      ["DELETE", "/1/interfaces/wg0/clients/phone"],
      ["GET", "/1/interfaces/wg0/clients/phone/config"],
    ];
    for (const [method, path, body] of calls) {
      await s.request(method, path, body);
    }
    expect(s.ssh.calls.length).toBeGreaterThan(15);
    for (const call of s.ssh.calls) {
      const out = spawnSync("bash", ["-n"], { input: call.stdin });
      expect(out.stderr.toString(), call.stdin.slice(0, 300)).toBe("");
      expect(out.status).toBe(0);
    }
  });
});
