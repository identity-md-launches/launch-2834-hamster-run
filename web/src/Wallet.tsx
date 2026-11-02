import { useEffect, useRef, useState } from "react";
import {
  useConnection,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { getAddress } from "viem";
import { chain, readableError } from "./chain";
import { OPEN_IN, isMobileBrowser } from "./open-in";

export const shortAddress = (address: string) =>
  `${getAddress(address).slice(0, 6)}…${getAddress(address).slice(-4)}`;
export function Wallet({ openSignal }: { openSignal: number }) {
  const { address, isConnected, chainId } = useConnection();
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [mobile, setMobile] = useState(false);
  const open = () => {
    setError("");
    setMobile(isMobileBrowser());
    dialog.current?.showModal();
  };
  useEffect(() => {
    if (openSignal > 0) open();
  }, [openSignal]);
  useEffect(() => {
    if (isConnected) dialog.current?.close();
  }, [isConnected]);
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  // A wallet's own phone browser can announce EIP-6963 without window.ethereum.
  const mobileOpen = mobile && !named;
  const listed = [
    ...connectors.filter((c) => c.type === "injected"),
    ...connectors.filter((c) => c.type !== "injected"),
  ].filter(
    (c) =>
      !(c.id === "injected" && named) && (!mobileOpen || c.type !== "injected"),
  );
  return (
    <>
      {isConnected && address ? (
        <div className="wallet-connected">
          {chainId !== chain.id ? (
            <button
              className="button button-small"
              disabled={switching}
              onClick={async () => {
                try {
                  setError("");
                  await switchChainAsync({ chainId: chain.id });
                } catch (e) {
                  setError(readableError(e));
                }
              }}
            >
              {switching ? "Switching…" : "Switch to Sepolia"}
            </button>
          ) : (
            <button
              className="button button-small"
              onClick={() => dialog.current?.showModal()}
              aria-label={`Manage wallet ${shortAddress(address)}`}
            >
              <span className="connected-dot" />
              {shortAddress(address)}
            </button>
          )}
        </div>
      ) : (
        <button className="button button-small" onClick={open}>
          <WalletGlyph />
          Connect wallet
        </button>
      )}
      {error && !dialog.current?.open && (
        <p className="wallet-note" role="status">
          {error}
        </p>
      )}
      <dialog
        ref={dialog}
        className="wallet-dialog"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
        aria-labelledby="wallet-title"
      >
        <div className="dialog-heading">
          <h2 id="wallet-title">
            {isConnected ? "Your wallet" : "Connect a wallet"}
          </h2>
          <button
            className="icon-button"
            onClick={() => dialog.current?.close()}
            aria-label="Close wallet picker"
          >
            ×
          </button>
        </div>
        {isConnected && address ? (
          <>
            <p className="break-address">{getAddress(address)}</p>
            <p className="muted">
              {chainId === chain.id
                ? "Connected to Sepolia"
                : "Switch to Sepolia to play"}
            </p>
            <button
              className="button full"
              onClick={() => {
                disconnect();
                dialog.current?.close();
              }}
            >
              Disconnect wallet
            </button>
          </>
        ) : (
          <>
            <p className="muted">A little game. A testnet wallet.</p>
            {mobileOpen &&
              OPEN_IN.map((w) => (
                <a
                  key={w.id}
                  className="wallet-row"
                  href={w.href(location.href)}
                >
                  <img
                    width="28"
                    height="28"
                    src={`./wallets/${w.id}.svg`}
                    alt=""
                  />
                  <span>Open in {w.name}</span>
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
            {listed.map((c) => (
              <button
                className="wallet-row"
                key={c.uid}
                disabled={isPending}
                onClick={async () => {
                  try {
                    setError("");
                    await connectAsync({ connector: c });
                    dialog.current?.close();
                  } catch (e) {
                    setError(readableError(e));
                  }
                }}
              >
                {c.icon ? (
                  <img width="28" height="28" src={c.icon} alt="" />
                ) : c.id === "coinbaseWalletSDK" ? (
                  <img
                    width="28"
                    height="28"
                    src="./wallets/coinbase.svg"
                    alt=""
                  />
                ) : (
                  <WalletGlyph />
                )}
                <span>
                  {c.id === "injected"
                    ? "Browser wallet"
                    : c.id === "coinbaseWalletSDK"
                      ? mobile
                        ? "Coinbase Smart Wallet"
                        : "Coinbase Wallet"
                      : c.name}
                  {isPending && variables?.connector === c ? " · opening…" : ""}
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
            <p className="small muted">
              No wallet found? Coinbase can create a passkey wallet. On phones,
              open this page in your wallet app.
            </p>
          </>
        )}
        <p role="status" className="error-text">
          {error}
        </p>
      </dialog>
    </>
  );
}
function WalletGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M20 7V4H5a2 2 0 0 0-2 2v13h19V7H5a1 1 0 0 1 0-2" />
      <path d="M22 12h-6v4h6M18 14h1" />
    </svg>
  );
}
