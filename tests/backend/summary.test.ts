import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";
import { DUMP } from "./fixtures";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const STATUS =
  "kernel=Linux\nroot=1\nos=Debian\npm=apt-get\ninstalled=1\nversion=wireguard-tools v1.0\ninit=systemd\nipforward=1\nfirewall=ufw\niptables=1\n";

async function setup(dump: string) {
  server = await startServer();
  server.mock.settings.set("host:1:enableWireguard", true);
  server.mock.ctx.currentActor = () => "u1";
  Object.assign(server.mock.ctx.hosts, { list: async () => [{ id: 1 }] });
  server.ssh.replies.push(
    { match: "kernel=", stdout: STATUS },
    { match: "ONLY=", stdout: dump },
  );
  return server;
}

describe("summary", () => {
  it("counts interfaces and clients", async () => {
    const s = await setup(DUMP);
    const res = await s.request("GET", "/summary");
    expect(res.body[0]).toMatchObject({
      hostId: 1,
      installed: true,
      total: 1,
      up: 1,
      down: 0,
      clients: 1,
    });
    expect(s.mock.notifications).toHaveLength(0);
  });

  it("alerts once when an enabled interface is not active", async () => {
    const s = await setup(DUMP.replace("@@ACTIVE:1", "@@ACTIVE:0"));
    const res = await s.request("GET", "/summary?refresh=1");
    expect(res.body[0]).toMatchObject({ down: 1, downNames: ["wg0"] });
    expect(s.mock.notifications).toHaveLength(1);
    expect(s.mock.notifications[0]!.notification.category).toBe(
      "wireguard.down",
    );
    await s.request("GET", "/summary?refresh=1");
    expect(s.mock.notifications).toHaveLength(1);
  });

  it("stays quiet when alerts are off", async () => {
    const s = await setup(DUMP.replace("@@ACTIVE:1", "@@ACTIVE:0"));
    s.mock.settings.set("host:1:alertDown", false);
    await s.request("GET", "/summary?refresh=1");
    expect(s.mock.notifications).toHaveLength(0);
  });
});
