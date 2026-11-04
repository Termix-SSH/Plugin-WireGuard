import { describe, expect, it } from "vitest";
import {
  allocateIp,
  appendPeer,
  interfaceInfo,
  maskSecrets,
  parseConf,
  parseLive,
  parseMeta,
  peerName,
  removePeer,
  renderConf,
  renderInterfaceConf,
  renderMeta,
  renderPeerBlock,
  restoreSecrets,
  setListenPort,
  setPeerDisabled,
} from "../../src/backend/config";

const CONF = `[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = SERVERPRIV=
PostUp = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

# termix:client phone
[Peer]
PublicKey = PHONEPUB=
PresharedKey = PHONEPSK=
AllowedIPs = 10.8.0.2/32

[Peer]
PublicKey = HANDMADE+/=
AllowedIPs = 10.8.0.3/32, 192.168.9.0/24
`;

describe("config parsing", () => {
  it("reads the interface and peers", () => {
    const conf = parseConf(CONF);
    const info = interfaceInfo(conf);
    expect(info.address).toEqual(["10.8.0.1/24"]);
    expect(info.listenPort).toBe(51820);
    expect(info.privateKey).toBe("SERVERPRIV=");
    expect(info.nat).toBe(true);
    expect(conf.peers).toHaveLength(2);
    expect(conf.peers[0]!.name).toBe("phone");
    expect(conf.peers[0]!.allowedIps).toEqual(["10.8.0.2/32"]);
    expect(peerName(conf.peers[1]!)).toBe("peer-HANDMADE");
  });

  it("round trips untouched", () => {
    expect(renderConf(parseConf(CONF))).toBe(CONF);
  });

  it("removes a peer and keeps the rest", () => {
    const out = removePeer(CONF, "phone");
    expect(out).not.toContain("PHONEPUB");
    expect(out).toContain("HANDMADE");
    expect(out).toContain("PrivateKey = SERVERPRIV=");
  });

  it("turns a peer off and on", () => {
    const off = setPeerDisabled(CONF, "phone", true);
    expect(off).toContain("# termix:client phone disabled");
    expect(off).toContain("#- [Peer]");
    const parsed = parseConf(off);
    expect(parsed.peers[0]!.disabled).toBe(true);
    expect(parsed.peers[0]!.publicKey).toBe("PHONEPUB=");
    const on = setPeerDisabled(off, "phone", false);
    expect(parseConf(on).peers[0]!.disabled).toBe(false);
    expect(on).toContain("\n[Peer]\nPublicKey = PHONEPUB=");
    expect(on).not.toContain("#- ");
  });

  it("names a hand made peer when it is turned off", () => {
    const name = peerName(parseConf(CONF).peers[1]!);
    const off = setPeerDisabled(CONF, name, true);
    const peer = parseConf(off).peers[1]!;
    expect(peer.name).toBe(name);
    expect(peer.disabled).toBe(true);
  });

  it("appends a peer block", () => {
    const out = appendPeer(CONF, renderPeerBlock("laptop", "10.8.0.4"));
    expect(out.endsWith("AllowedIPs = 10.8.0.4/32\n")).toBe(true);
    expect(parseConf(out).peers).toHaveLength(3);
  });

  it("sets and adds the listen port", () => {
    expect(setListenPort(CONF, 4000)).toContain("ListenPort = 4000");
    const bare = "[Interface]\nPrivateKey = x\n";
    expect(setListenPort(bare, 4000)).toContain("ListenPort = 4000");
  });
});

describe("addresses", () => {
  it("picks the lowest free address", () => {
    expect(allocateIp(parseConf(CONF))).toBe("10.8.0.4");
  });

  it("counts turned off peers as used", () => {
    const off = setPeerDisabled(CONF, "phone", true);
    expect(allocateIp(parseConf(off))).toBe("10.8.0.4");
  });

  it("fills a gap", () => {
    expect(allocateIp(parseConf(removePeer(CONF, "phone")))).toBe("10.8.0.2");
  });

  it("fails when the subnet is full", () => {
    const small =
      "[Interface]\nAddress = 10.0.0.1/30\n\n[Peer]\nPublicKey = a\nAllowedIPs = 10.0.0.2/32\n";
    expect(() => allocateIp(parseConf(small))).toThrow();
  });
});

describe("secrets", () => {
  it("hides keys and puts them back", () => {
    const masked = maskSecrets(CONF);
    expect(masked).not.toContain("SERVERPRIV");
    expect(masked).not.toContain("PHONEPSK");
    expect(masked).toContain("PublicKey = PHONEPUB=");
    expect(restoreSecrets(masked, CONF)).toBe(CONF);
  });

  it("keeps edits made around hidden keys", () => {
    const masked = maskSecrets(CONF).replace("51820", "5000");
    const out = restoreSecrets(masked, CONF);
    expect(out).toContain("ListenPort = 5000");
    expect(out).toContain("PrivateKey = SERVERPRIV=");
  });

  it("refuses a hidden key with nothing to keep", () => {
    expect(() =>
      restoreSecrets("[Interface]\nPrivateKey = __KEEP__\n", "[Interface]\n"),
    ).toThrow();
  });
});

describe("templates", () => {
  it("renders a server config with NAT", () => {
    const text = renderInterfaceConf({
      address: ["10.8.0.1/24"],
      port: 51820,
      nat: true,
    });
    expect(text).toContain("PrivateKey = __PRIV__");
    expect(text).toContain("-o __NIC__ -j MASQUERADE");
    expect(text).not.toContain("ip6tables");
  });

  it("adds ip6tables for an IPv6 address", () => {
    const text = renderInterfaceConf({
      address: ["10.8.0.1/24", "fd42::1/64"],
      port: 51820,
      nat: true,
    });
    expect(text).toContain("ip6tables -t nat -A POSTROUTING");
  });

  it("keeps meta", () => {
    const meta = {
      endpoint: "vpn.example.com:51820",
      dns: "1.1.1.1",
      allowed: "0.0.0.0/0",
      keepalive: 15,
    };
    expect(parseMeta(renderMeta(meta))).toEqual(meta);
  });

  it("reads wg dump", () => {
    const live = parseLive(
      "priv\tSPUB\t51820\toff\nCPUB\tpsk\t1.2.3.4:555\t10.8.0.2/32\t1700000000\t100\t200\t25\nOTHER\t(none)\t(none)\t10.8.0.3/32\t0\t0\t0\toff\n",
    );
    expect(live.publicKey).toBe("SPUB");
    expect(live.peers.get("CPUB")).toEqual({
      endpoint: "1.2.3.4:555",
      handshake: 1700000000,
      rx: 100,
      tx: 200,
    });
    expect(live.peers.get("OTHER")!.endpoint).toBe("");
  });
});
