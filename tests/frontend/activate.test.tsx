import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import { formatAgo, formatBytes, isConnected } from "../../src/frontend/format";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const status = {
  root: true,
  os: "Debian GNU/Linux 13",
  packageManager: "apt-get",
  installed: true,
  version: "wireguard-tools v1.0",
  init: "systemd",
  ipForward: true,
  firewall: "ufw",
  iptables: true,
};

const interfaces = [
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
];

const clients = [
  {
    name: "phone",
    publicKey: "PHONEPUB=",
    allowedIps: ["10.8.0.2/32"],
    enabled: true,
    managed: true,
    hasConfig: true,
    endpoint: "",
    latestHandshake: 0,
    rx: 0,
    tx: 0,
  },
];

function api(current: unknown) {
  return {
    get: vi.fn(async (url: string) => ({
      data: url.endsWith("/status")
        ? current
        : url.endsWith("/interfaces")
          ? interfaces
          : url.endsWith("/clients")
            ? clients
            : url.endsWith("/config")
              ? { name: "phone", config: "[Interface]\nPrivateKey = K\n" }
              : {},
    })),
  } as never;
}

const host = { id: 1, name: "vpn", enableSsh: true };

describe(`${manifest.id} activate`, () => {
  it("registers the host tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["wireguard"]);
  });

  it("lists interfaces", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("wireguard", { isVisible: true, host });
    expect(await screen.findByText("wg0")).toBeTruthy();
    expect(screen.getByText(locales.interfaces.nat)).toBeTruthy();
  });

  it("opens an interface and lists its clients", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("wireguard", { isVisible: true, host });
    fireEvent.click(await screen.findByText("wg0"));
    expect(await screen.findByText("phone")).toBeTruthy();
    expect(screen.getByText("10.8.0.2/32")).toBeTruthy();
  });

  it("offers to install when WireGuard is missing", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api({ ...status, installed: false }),
    });
    rendered.renderTab("wireguard", { isVisible: true, host });
    expect(await screen.findByText(locales.install.empty)).toBeTruthy();
    expect(screen.getByText(locales.install.button)).toBeTruthy();
  });

  it("shows an error when the host cannot be read", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => {
          throw new Error("offline");
        }),
      } as never,
    });
    rendered.renderTab("wireguard", { isVisible: true, host });
    expect(await screen.findByText(locales.tab.error)).toBeTruthy();
  });
});

describe("formatting", () => {
  it("formats sizes and times", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatAgo(1000, 1_000_000 + 30_000)).toBe("30s");
    expect(formatAgo(1000, 1_000_000 + 7_200_000)).toBe("2h");
    expect(isConnected(0)).toBe(false);
    expect(isConnected(Date.now() / 1000 - 10)).toBe(true);
    expect(isConnected(Date.now() / 1000 - 1000)).toBe(false);
  });
});
