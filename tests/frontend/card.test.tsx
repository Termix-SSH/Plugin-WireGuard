import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  hosts: [] as Array<Record<string, unknown>>,
  openTab: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@termix-ssh/plugin-sdk/frontend", async (original) => ({
  ...(await original<object>()),
  useHosts: () => ({ hosts: mocks.hosts }),
  useCurrentUser: () => ({ isAdmin: false }),
  useTabs: () => ({ openTab: mocks.openTab }),
  useToast: () => ({ success: mocks.success, error: mocks.error }),
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
}));

import { initApi } from "../../src/frontend/api";
import { WireguardCard } from "../../src/frontend/WireguardCard";

const pluginSettings = { wireguard: { enableWireguard: true } };
const wg0 = {
  name: "wg0",
  active: true,
  address: ["10.8.0.1/24"],
  clients: 2,
};

function setup(installed = true) {
  const post = vi.fn(async () => ({ data: {} }));
  const get = vi.fn(async (url: string) => ({
    data: url.endsWith("/status") ? { installed } : [wg0],
  }));
  initApi({ get, post } as never);
  return { get, post };
}

afterEach(() => {
  cleanup();
  mocks.hosts = [];
  vi.clearAllMocks();
});

describe("WireguardCard", () => {
  it("tells the user to turn WireGuard on", async () => {
    const { get } = setup();
    mocks.hosts = [{ id: 7 }];
    render(<WireguardCard hostId={7} />);
    expect(await screen.findByText("manager.disabled")).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it("says when WireGuard is not installed", async () => {
    setup(false);
    mocks.hosts = [{ id: 7, pluginSettings }];
    render(<WireguardCard hostId={7} />);
    expect(await screen.findByText("tab.notInstalled")).toBeTruthy();
  });

  it("brings an interface down without opening the tab", async () => {
    const { post } = setup();
    mocks.hosts = [{ id: 7, pluginSettings }];
    render(<WireguardCard hostId={7} />);
    fireEvent.click(await screen.findByText("manager.stop"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/7/interfaces/wg0/service/stop"),
    );
    expect(mocks.openTab).not.toHaveBeenCalled();
  });

  it("opens the tab from a row", async () => {
    setup();
    const host = { id: 7, pluginSettings };
    mocks.hosts = [host];
    render(<WireguardCard hostId={7} />);
    fireEvent.click(await screen.findByText("wg0"));
    expect(mocks.openTab).toHaveBeenCalledWith(host, "wireguard");
  });

  it("hides the button from a connect only user", async () => {
    setup();
    mocks.hosts = [
      { id: 7, pluginSettings, isShared: true, permissionLevel: "connect" },
    ];
    render(<WireguardCard hostId={7} />);
    expect(await screen.findByText("wg0")).toBeTruthy();
    expect(screen.queryByText("manager.stop")).toBeNull();
  });
});
