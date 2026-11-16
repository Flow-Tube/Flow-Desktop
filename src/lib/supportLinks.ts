export const OPEN_COLLECTIVE_URL = "https://opencollective.com/flow-tube";
export const PATREON_URL = "https://patreon.com/A_EDev";

export type CryptoMethod = {
  name: string;
  ticker: string;
  network: string;
  address: string;
  qr: string;
};

export const CRYPTO_METHODS: readonly CryptoMethod[] = [
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
