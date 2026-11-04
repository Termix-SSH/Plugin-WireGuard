import { afterEach, describe, expect, it } from "vitest";
import { DUMP } from "./fixtures";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

function withDump(s: TestServer) {
  s.ssh.replies.push({ match: "ONLY=", stdout: DUMP });
}

describe("status and install", () => {
  it("reads the status", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "kernel=",
      stdout:
        "kernel=Linux\nroot=1\nos=Debian\npm=apt-get\ninstalled=1\nversion=wireguard-tools v1.0\ninit=systemd\nipforward=1\nfirewall=ufw\niptables=1\n",
    });
    const res = await server.request("GET", "/1/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      root: true,
      installed: true,
      init: "systemd",
      ipForward: true,
      firewall: "ufw",
      iptables: true,
    });
  });

  it("refuses a host that is not Linux", async () => {
    server = await startServer();
    server.ssh.replies.push({ match: "kernel=", stdout: "kernel=Darwin\n" });
    const res = await server.request("GET", "/1/status");
    expect(res.status).toBe(400);
  });

  it("asks for sudo when it is missing", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "ONLY=",
      stderr: "sudo: a password is required",
      code: 1,
    });
    const res = await server.request("GET", "/1/interfaces");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("sudo");
  });

  it("installs", async () => {
    server = await startServer();
    const res = await server.request("POST", "/1/install");
    expect(res.status).toBe(200);
    expect(server.ssh.calls[0]!.stdin).toContain(
      "apt-get install -y wireguard",
    );
  });

  it("reports an install that fails", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "apt-get install",
      stdout: "WG_ERR:No supported package manager found on this host\n",
      code: 5,
    });
    const res = await server.request("POST", "/1/install");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No supported package manager");
  });
});

describe("access", () => {
  it("needs the permission", async () => {
    server = await startServer({ permissions: [] });
    const res = await server.request("GET", "/1/interfaces");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(server.ssh.calls).toHaveLength(0);
  });

  it("lets connect users read but not change", async () => {
    server = await startServer({ level: "connect" });
    withDump(server);
    expect((await server.request("GET", "/1/interfaces")).status).toBe(200);
    const res = await server.request("POST", "/1/interfaces/wg0/clients", {
      name: "x",
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("HOST_EDIT_REQUIRED");
    const cfg = await server.request(
      "GET",
      "/1/interfaces/wg0/clients/phone/config",
    );
    expect(cfg.status).toBe(403);
  });

  it("hides hosts the user cannot reach", async () => {
    server = await startServer({ level: "none" });
    expect((await server.request("GET", "/1/interfaces")).status).toBe(404);
  });
});

describe("interfaces", () => {
  it("lists them", async () => {
    server = await startServer();
    withDump(server);
    const res = await server.request("GET", "/1/interfaces");
    expect(res.body).toEqual([
      {
        name: "wg0",
        active: true,
        enabled: true,
        address: ["10.8.0.1/24"],
        listenPort: 51820,
        publicKey: "SERVERPUB=",
        endpoint: "vpn.example.com:51820",
        dns: "1.1.1.1",
        allowedIps: "0.0.0.0/0, ::/0",
        keepalive: 25,
        nat: true,
        clients: 1,
      },
    ]);
  });

  it("creates one with keys made on the host", async () => {
    server = await startServer();
    const res = await server.request("POST", "/1/interfaces", {
      name: "wg1",
      address: "10.9.0.1/24",
      listenPort: 51821,
      endpoint: "vpn.example.com:51821",
      nat: true,
      forwarding: true,
      openFirewall: true,
      start: true,
    });
    expect(res.status).toBe(200);
    const script = server.ssh.calls.at(-1)!.stdin;
    expect(script).toContain("wg genkey");
    expect(script).toContain("/etc/wireguard/wg1.conf");
    expect(script).toContain("ip_forward");
    expect(script).toContain("ufw allow 51821/udp");
    expect(script).toContain("systemctl enable --now wg-quick@wg1");
    expect(script).not.toContain("PRIVATEKEYVALUE");
  });

  it("refuses a taken name or port", async () => {
    server = await startServer();
    withDump(server);
    const body = { address: "10.9.0.1/24", listenPort: 51821 };
    expect(
      (await server.request("POST", "/1/interfaces", { ...body, name: "wg0" }))
        .status,
    ).toBe(400);
    expect(
      (
        await server.request("POST", "/1/interfaces", {
          ...body,
          name: "wg2",
          listenPort: 51820,
        })
      ).status,
    ).toBe(400);
  });

  it("refuses bad input", async () => {
    server = await startServer();
    for (const bad of [
      { name: "wg1; id", address: "10.9.0.1/24", listenPort: 1 },
      { name: "wgtx1", address: "10.9.0.1/24", listenPort: 1 },
      { name: "wg1", address: "nope", listenPort: 1 },
      { name: "wg1", address: "10.9.0.1/24", listenPort: 0 },
      {
        name: "wg1",
        address: "10.9.0.1/24",
        listenPort: 1,
        endpoint: "x';id;'",
      },
    ]) {
      const res = await server.request("POST", "/1/interfaces", bad);
      expect(res.status).toBe(400);
    }
    expect(server.ssh.calls).toHaveLength(0);
  });

  it("updates the port and defaults", async () => {
    server = await startServer();
    withDump(server);
    const res = await server.request("PUT", "/1/interfaces/wg0", {
      listenPort: 4000,
      endpoint: "vpn.example.com:4000",
      dns: "9.9.9.9",
      allowedIps: "10.0.0.0/8",
      keepalive: 15,
    });
    expect(res.status).toBe(200);
    expect(server.ssh.calls.at(-1)!.stdin).toContain("wg syncconf wg0");
  });

  it("deletes one", async () => {
    server = await startServer();
    const res = await server.request("DELETE", "/1/interfaces/wg0");
    expect(res.status).toBe(200);
    expect(server.ssh.calls[0]!.stdin).toContain(
      "rm -rf /etc/wireguard/termix/wg0",
    );
  });

  it("controls the service", async () => {
    server = await startServer();
    for (const a of ["start", "stop", "restart", "enable", "disable"]) {
      expect(
        (await server.request("POST", `/1/interfaces/wg0/service/${a}`)).status,
      ).toBe(200);
    }
    expect(
      (await server.request("POST", "/1/interfaces/wg0/service/nuke")).status,
    ).toBe(400);
  });
});

describe("clients", () => {
  it("lists them with live data", async () => {
    server = await startServer();
    withDump(server);
    const res = await server.request("GET", "/1/interfaces/wg0/clients");
    expect(res.body).toEqual([
      {
        name: "phone",
        publicKey: "PHONEPUB=",
        allowedIps: ["10.8.0.2/32"],
        enabled: true,
        managed: true,
        hasConfig: true,
        endpoint: "1.2.3.4:555",
        latestHandshake: 1700000000,
        rx: 100,
        tx: 200,
      },
    ]);
  });

  it("adds one with the next free address", async () => {
    server = await startServer();
    withDump(server);
    server.ssh.replies.push({
      match: "SPRIV=",
      stdout: "@@CLIENT\n[Interface]\nPrivateKey = K\n\ndone\n",
    });
    const res = await server.request("POST", "/1/interfaces/wg0/clients", {
      name: "laptop",
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("laptop");
    expect(res.body.config).toContain("[Interface]");
    expect(res.body.config).not.toContain("done");
    const script = server.ssh.calls.at(-1)!.stdin;
    expect(script).toContain("wg genpsk");
    expect(script).toContain("/etc/wireguard/termix/wg0/laptop.conf");
  });

  it("needs an endpoint first", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "ONLY=",
      stdout: DUMP.replace("endpoint=vpn.example.com:51820", "endpoint="),
    });
    const res = await server.request("POST", "/1/interfaces/wg0/clients", {
      name: "laptop",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("endpoint");
  });

  it("refuses a duplicate or bad name", async () => {
    server = await startServer();
    withDump(server);
    expect(
      (
        await server.request("POST", "/1/interfaces/wg0/clients", {
          name: "phone",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await server.request("POST", "/1/interfaces/wg0/clients", {
          name: "a; id",
        })
      ).status,
    ).toBe(400);
  });

  it("turns one off, rotates and removes", async () => {
    server = await startServer();
    withDump(server);
    server.ssh.replies.push({
      match: "SPRIV=",
      stdout: "@@CLIENT\n[Interface]\n",
    });
    const off = await server.request(
      "POST",
      "/1/interfaces/wg0/clients/phone/state",
      { enabled: false },
    );
    expect(off.status).toBe(200);
    expect(server.ssh.calls.at(-1)!.stdin).toContain("wg-quick strip");
    const rotate = await server.request(
      "POST",
      "/1/interfaces/wg0/clients/phone/rotate",
    );
    expect(rotate.status).toBe(200);
    const gone = await server.request(
      "DELETE",
      "/1/interfaces/wg0/clients/phone",
    );
    expect(gone.status).toBe(200);
    expect(server.ssh.calls.at(-1)!.stdin).toContain(
      "rm -f /etc/wireguard/termix/wg0/phone.conf",
    );
    const missing = await server.request(
      "DELETE",
      "/1/interfaces/wg0/clients/nobody",
    );
    expect(missing.status).toBe(404);
  });

  it("returns a saved client config and audits it", async () => {
    server = await startServer();
    withDump(server);
    server.ssh.replies.push({
      match: "cat /etc/wireguard/termix/wg0/phone.conf",
      stdout: "[Interface]\nPrivateKey = CPRIV\n",
    });
    const res = await server.request(
      "GET",
      "/1/interfaces/wg0/clients/phone/config",
    );
    expect(res.status).toBe(200);
    expect(res.body.config).toContain("CPRIV");
    expect(
      (await server.request("GET", "/1/interfaces/wg0/clients/nobody/config"))
        .status,
    ).toBe(404);
  });
});

describe("config", () => {
  it("hides keys when reading", async () => {
    server = await startServer();
    withDump(server);
    const res = await server.request("GET", "/1/interfaces/wg0/config");
    expect(res.body.text).toContain("PublicKey = PHONEPUB=");
    expect(res.body.text).not.toContain("SERVERPRIV");
    expect(res.body.text).not.toContain("PHONEPSK");
  });

  it("puts hidden keys back when saving", async () => {
    server = await startServer();
    withDump(server);
    const read = await server.request("GET", "/1/interfaces/wg0/config");
    const res = await server.request("PUT", "/1/interfaces/wg0/config", {
      text: String(read.body.text).replace("51820", "5000"),
    });
    expect(res.status).toBe(200);
    const script = server.ssh.calls.at(-1)!.stdin;
    const encoded = /echo '([^']+)' \| base64 -d > "\$T"/.exec(script)![1]!;
    const saved = Buffer.from(encoded, "base64").toString("utf8");
    expect(saved).toContain("PrivateKey = SERVERPRIV=");
    expect(saved).toContain("PresharedKey = PHONEPSK=");
    expect(saved).toContain("ListenPort = 5000");
  });

  it("rejects a big or broken config", async () => {
    server = await startServer();
    withDump(server);
    expect(
      (
        await server.request("PUT", "/1/interfaces/wg0/config", {
          text: "x".repeat(101_000),
        })
      ).status,
    ).toBe(400);
    expect(
      (await server.request("PUT", "/1/interfaces/wg0/config", { text: 5 }))
        .status,
    ).toBe(400);
  });

  it("reports a check failure from wg-quick", async () => {
    server = await startServer();
    withDump(server);
    server.ssh.replies.push({
      match: "wg-quick strip",
      stdout: "WG_ERR:Line unrecognized: `Foo=bar'\n",
      code: 3,
    });
    const res = await server.request("PUT", "/1/interfaces/wg0/config", {
      text: "[Interface]\nFoo=bar\n",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Line unrecognized");
  });
});

describe("logs", () => {
  it("returns the journal", async () => {
    server = await startServer();
    server.ssh.replies.push({ match: "journalctl", stdout: "line one\n" });
    const res = await server.request("GET", "/1/logs?lines=50");
    expect(res.body.text).toBe("line one\n");
  });
});
