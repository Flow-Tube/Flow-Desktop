import { describe, expect, it } from "vitest";
import { firewallCommands } from "./syncFirewall";

describe("firewallCommands", () => {
  it("opens the port on each installed firewall", () => {
    expect(firewallCommands(["ufw", "firewalld"], 47901, false)).toEqual([
      "sudo ufw allow 47901/tcp",
      "sudo firewall-cmd --permanent --add-port=47901/tcp && sudo firewall-cmd --reload",
    ]);
  });

  it("adds discovery for Linked devices", () => {
    expect(firewallCommands(["ufw"], 47900, true)).toEqual(["sudo ufw allow 47900/tcp", "sudo ufw allow 5353/udp"]);
    expect(firewallCommands(["firewalld"], 47900, true)).toEqual([
      "sudo firewall-cmd --permanent --add-port=47900/tcp --add-service=mdns && sudo firewall-cmd --reload",
    ]);
  });

  it("has nothing to run without a known firewall", () => {
    expect(firewallCommands([], 47901, true)).toEqual([]);
    expect(firewallCommands(["nftables"], 47901, true)).toEqual([]);
  });
});
