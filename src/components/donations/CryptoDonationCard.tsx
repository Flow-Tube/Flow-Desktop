import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { copyText } from "../../lib/clipboard";
import { getString } from "../../lib/i18n/index";
import { CRYPTO_METHODS } from "../../lib/supportLinks";
import { useUiStore } from "../../store/useUiStore";

/** One coin at a time, so the page shows a single QR code instead of a wall of them. */
export function CryptoDonationCard() {
  const [ticker, setTicker] = useState(CRYPTO_METHODS[0]!.ticker);
  const method = CRYPTO_METHODS.find((item) => item.ticker === ticker) ?? CRYPTO_METHODS[0]!;

  const copyAddress = async () => {
    const copied = await copyText(method.address);
    useUiStore.getState().showToast({
      variant: copied ? "success" : "error",
      message: getString(copied ? "donations_address_copied" : "donations_copy_failed"),
    });
  };

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-semibold text-primary">{getString("donations_crypto_label")}</h2>
      <div className="rounded-2xl bg-surface-row p-5">
        <SegmentedControl
          stretch
          label={getString("donations_crypto_label")}
          value={ticker}
          onChange={setTicker}
          options={CRYPTO_METHODS.map((item) => ({ value: item.ticker, label: item.name }))}
        />

        <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-xl bg-chrome-white p-2.5">
            <img src={method.qr} alt={getString("donations_qr_alt", method.name)} className="h-40 w-40 rounded-md" />
          </div>

          <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-medium text-chrome-neutral-100">{method.name}</span>
              <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] font-semibold text-chrome-neutral-300">
                {method.ticker}
              </span>
            </div>
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-xs text-chrome-neutral-500">{getString("donations_network_label")}</dt>
                <dd className="mt-0.5 text-chrome-neutral-200">{method.network}</dd>
              </div>
              <div>
                <dt className="text-xs text-chrome-neutral-500">{getString("donations_address_label")}</dt>
                <dd
                  dir="ltr"
                  className="mt-1 select-text break-all rounded-lg bg-surface-container px-3 py-2 font-mono text-xs leading-relaxed text-chrome-neutral-200"
                >
                  {method.address}
                </dd>
              </div>
            </dl>
            <Button variant="tonal" onClick={() => void copyAddress()} className="self-start">
              <Copy className="h-4 w-4" />
              {getString("donations_copy_address")}
            </Button>
          </div>
        </div>

        <p className="mt-5 text-xs text-chrome-neutral-400">{getString("donations_crypto_hint")}</p>
      </div>
    </section>
  );
}
