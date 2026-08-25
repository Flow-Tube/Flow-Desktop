import { Copy, Heart } from "lucide-react";
import { Button } from "../components/ui/Button";
import { getString } from "../lib/i18n/index";
import { openExternal } from "../lib/openExternal";
import { useUiStore } from "../store/useUiStore";

const PATREON_URL = "https://patreon.com/A_EDev";

type CryptoMethod = {
  name: string;
  ticker: string;
  network: string;
  address: string;
  qr: string;
};

const CRYPTO_METHODS: readonly CryptoMethod[] = [
  {
    name: "Bitcoin",
    ticker: "BTC",
    network: "Bitcoin",
    address: "bc1qgmkkxxvzvsymtpfazqfl93jw6k4jgy0xmrtnv8",
    qr: "/donations/bitcoin.png",
  },
  {
    name: "Ethereum",
    ticker: "ETH",
    network: "ERC-20",
    address: "0xfbac6f464fec7fe458e318971a42ba45b305b70e",
    qr: "/donations/ethereum.png",
  },
  {
    name: "Solana",
    ticker: "SOL",
    network: "Solana",
    address: "7b3SLgiVPb8qQUvERSPGRWoFoiGEDvkFuY98M1GEngug",
    qr: "/donations/solana.png",
  },
  {
    name: "USDT",
    ticker: "USDT",
    network: "TRC-20",
    address: "TRz7VDrTWwCLCfQmYBEJakqcZgbFNWfUMP",
    qr: "/donations/usdt-trc20.png",
  },
  {
    name: "Monero",
    ticker: "XMR",
    network: "Monero",
    address: "8AgaxZnpEvT8VXJpczpL7BQejwSEw97saJmKYqq4zKErbe9bkYSwUhJ813msPPbdYhF11oz4N7tfEj4Zi6k27fKD83ca1if",
    qr: "/donations/monero.png",
  },
];

function CryptoMethodCard({
  method,
  onCopy,
}: {
  method: CryptoMethod;
  onCopy: (method: CryptoMethod) => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-chrome-neutral-800/50 bg-surface-container-low p-4">
      <div className="self-center rounded-xl bg-chrome-white p-2.5">
        <img
          src={method.qr}
          alt={getString("donations_qr_alt", method.name)}
          loading="lazy"
          className="h-36 w-36 rounded-md"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base font-medium text-chrome-neutral-200">{method.name}</span>
          <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] font-semibold tracking-wide text-chrome-neutral-400">
            {method.ticker}
          </span>
        </div>
        <span className="shrink-0 text-xs uppercase tracking-wider text-chrome-neutral-500">
          {method.network}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onCopy(method)}
        title={getString("donations_copy_address")}
        aria-label={getString("donations_copy_address")}
        className="mt-3 flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-left transition-colors duration-200 ease-out hover:bg-surface-container-high"
      >
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-chrome-neutral-300">
          {method.address}
        </code>
        <Copy className="h-4 w-4 shrink-0 text-chrome-neutral-400" />
      </button>
    </div>
  );
}

export default function Donations() {
  const showToast = useUiStore((state) => state.showToast);

  const handleCopy = async (method: CryptoMethod) => {
    try {
      await navigator.clipboard.writeText(method.address);
      showToast({
        variant: "success",
        message: getString("donations_address_copied"),
      });
    } catch (error) {
      console.warn("Failed to copy donation address", error);
      showToast({
        variant: "error",
        message: getString("donations_copy_failed"),
      });
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      {/* Hero */}
      <header className="flex flex-col items-center text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-container">
          <Heart className="h-7 w-7 text-[var(--color-primary)]" />
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-chrome-neutral-100">
          {getString("donations_title")}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-chrome-neutral-400">
          {getString("donations_subtitle")}
        </p>
      </header>

      {/* Patreon */}
      <section className="mt-8 rounded-2xl border border-chrome-neutral-800/50 bg-surface-container-low p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-medium text-chrome-neutral-200">
              {getString("donations_patreon_title")}
            </h2>
            <p className="mt-1 text-sm text-chrome-neutral-400">
              {getString("donations_patreon_desc")}
            </p>
          </div>
          <Button onClick={() => void openExternal(PATREON_URL)} className="shrink-0 px-5">
            <Heart className="h-4 w-4" />
            {getString("donations_patreon_button")}
          </Button>
        </div>
      </section>

      {/* Crypto */}
      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
          {getString("donations_crypto_label")}
        </h2>
        <p className="mt-2 text-sm text-chrome-neutral-400">
          {getString("donations_crypto_hint")}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CRYPTO_METHODS.map((method) => (
            <CryptoMethodCard key={method.ticker} method={method} onCopy={handleCopy} />
          ))}
        </div>
      </section>

      <p className="mt-10 text-center text-sm font-medium text-chrome-neutral-400">
        {getString("donations_thank_you")}
      </p>
    </div>
  );
}
