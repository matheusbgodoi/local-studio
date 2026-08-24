"use client";

import { Lock } from "@/ui/icon-registry";
import { Stat } from "@/ui";
import { isNetworkUnavailable } from "@/features/agent/network/network-labels";
import { useNetworkStatus } from "@/features/agent/network/use-network-status";

//
// What a protected Run says about its boundary, in the two places a Run is
// shown. Both are mounted only for a Run whose policy is `vpn_protected`, so a
// Direct run costs nothing and the store keeps sleeping.
//
// A blocked tunnel is NOT a failed Run. The Run is waiting on infrastructure in
// exactly the way a Run whose backend went away is waiting, so this reads in the
// warning colour and never in the failure colour, and it never borrows the
// Run's own status pill.
//

function useProtectedNetworkState(): { unavailable: boolean } {
  const { status } = useNetworkStatus(true);
  return { unavailable: status ? isNetworkUnavailable(status.state) : false };
}

/** The inline Run panel's footer meta line. */
export function RunNetworkBadge() {
  const { unavailable } = useProtectedNetworkState();
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 ${unavailable ? "text-(--ui-warning)" : ""}`}
    >
      <Lock className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      {unavailable ? "Network blocked — VPN unavailable" : "VPN Protected"}
    </span>
  );
}

/** The /runs deep view's Stat row. */
export function RunNetworkStat() {
  const { unavailable } = useProtectedNetworkState();
  return (
    <Stat
      label="Network"
      value={
        <span className={unavailable ? "text-(--ui-warning)" : undefined}>
          {unavailable ? "VPN unavailable" : "VPN Protected"}
        </span>
      }
    />
  );
}
