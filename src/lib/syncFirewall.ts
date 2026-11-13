import { useEffect, useState } from "react";
import { getSyncFirewallHelp, type FirewallHelp } from "./api/sync";

/** Discovery on the network; Linked devices also needs it, one-time transfer does not. */
const MDNS_PORT = 5353;

/**
 * One command per installed firewall that lets the other device reach `port`. The rules are
 * permanent, since the port is fixed unless something else already held it.
 */
export function firewallCommands(firewalls: readonly string[], port: number, discovery: boolean): string[] {
  return firewalls.flatMap((firewall) => {
    if (firewall === "ufw") {
      return [`sudo ufw allow ${port}/tcp`, ...(discovery ? [`sudo ufw allow ${MDNS_PORT}/udp`] : [])];
    }
    if (firewall === "firewalld") {
      const mdns = discovery ? " --add-service=mdns" : "";
      return [`sudo firewall-cmd --permanent --add-port=${port}/tcp${mdns} && sudo firewall-cmd --reload`];
    }
    return [];
  });
}

/** The firewalls on this computer and the Linked devices port, read once per mount. */
export function useSyncFirewallHelp(): FirewallHelp | null {
  const [help, setHelp] = useState<FirewallHelp | null>(null);
  useEffect(() => {
    let active = true;
    getSyncFirewallHelp()
      .then((result) => {
        if (active) setHelp(result);
      })
      .catch(() => {
        // Without it the hint still explains the problem, just with no command.
      });
    return () => {
      active = false;
    };
  }, []);
  return help;
}
