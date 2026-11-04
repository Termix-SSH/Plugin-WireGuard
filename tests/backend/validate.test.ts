import { describe, expect, it } from "vitest";
import {
  addressList,
  allowedList,
  clientName,
  dnsList,
  endpoint,
  ifaceName,
  keepalive,
  port,
  q,
} from "../../src/backend/validate";

describe("validators", () => {
  it("accepts good interface names and blocks Tunnels ones", () => {
    expect(ifaceName("wg0")).toBe("wg0");
    expect(() => ifaceName("wgtx3")).toThrow();
    expect(() => ifaceName("0wg")).toThrow();
    expect(() => ifaceName("wg0; rm -rf /")).toThrow();
    expect(() => ifaceName("../wg0")).toThrow();
    expect(() => ifaceName("averyveryverylongname")).toThrow();
  });

  it("checks client names", () => {
    expect(clientName("phone-1")).toBe("phone-1");
    expect(() => clientName("a b")).toThrow();
    expect(() => clientName("../x")).toThrow();
    expect(() => clientName("")).toThrow();
  });

  it("checks addresses", () => {
    expect(addressList("10.8.0.1/24")).toEqual(["10.8.0.1/24"]);
    expect(addressList("10.8.0.1/24, fd42::1/64")).toHaveLength(2);
    expect(() => addressList("10.8.0.1")).toThrow();
    expect(() => addressList("10.8.0.1/31")).toThrow();
    expect(() => addressList("300.1.1.1/24")).toThrow();
    expect(() => addressList("")).toThrow();
  });

  it("checks ports", () => {
    expect(port("51820")).toBe(51820);
    expect(() => port(0)).toThrow();
    expect(() => port(70000)).toThrow();
    expect(() => port("a")).toThrow();
  });

  it("checks endpoints", () => {
    expect(endpoint("")).toBe("");
    expect(endpoint("vpn.example.com:51820")).toBe("vpn.example.com:51820");
    expect(endpoint("1.2.3.4:51820")).toBe("1.2.3.4:51820");
    expect(endpoint("[fd00::1]:51820")).toBe("[fd00::1]:51820");
    expect(() => endpoint("vpn.example.com")).toThrow();
    expect(() => endpoint("a b:51820")).toThrow();
    expect(() => endpoint("x';id;':1")).toThrow();
  });

  it("checks dns and allowed ranges", () => {
    expect(dnsList("1.1.1.1 8.8.8.8")).toBe("1.1.1.1, 8.8.8.8");
    expect(() => dnsList("1.1.1.1; id")).toThrow();
    expect(allowedList("")).toBe("0.0.0.0/0, ::/0");
    expect(allowedList("10.0.0.0/8,192.168.1.0/24")).toBe(
      "10.0.0.0/8, 192.168.1.0/24",
    );
    expect(() => allowedList("10.0.0.0/33")).toThrow();
    expect(() => allowedList("nonsense")).toThrow();
  });

  it("checks keepalive", () => {
    expect(keepalive(undefined)).toBe(25);
    expect(keepalive(0)).toBe(0);
    expect(() => keepalive(-1)).toThrow();
    expect(() => keepalive(5000)).toThrow();
  });

  it("quotes shell values", () => {
    expect(q("a'b")).toBe(`'a'"'"'b'`);
  });
});
