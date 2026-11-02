import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useSignMessage } from "wagmi";
import { isAddress, type Address, type Hash } from "viem";
import { normalizeHandle, shareLink } from "./game";
import { readableError } from "./chain";

let configuredUrl: Promise<string> | undefined;
export function serviceUrl(): Promise<string> {
  return (configuredUrl ??= fetch("./site-config.json")
    .then(async (r) => {
      if (!r.ok)
        throw new Error(
          "Invite configuration is unavailable. Reload to retry.",
        );
      const c = (await r.json()) as { inviteServiceUrl?: string };
      const url = new URL(c.inviteServiceUrl || "./api", location.href);
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          /^(localhost|127\.0\.0\.1)$/.test(url.hostname)
        )
      )
        throw new Error("The invite service needs HTTPS.");
      return url.toString().replace(/\/$/, "");
    })
    .catch((e) => {
      configuredUrl = undefined;
      throw e;
    }));
}
export async function inviteApi<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`${await serviceUrl()}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      data.error || "Invite service unavailable. Retry when it is online.",
    );
  return data;
}
type Challenge = { id: string; message: string };
export type PendingInvite = { wallet: Address; hash: Hash; ref: string };
const PENDING_KEY = "hamsterrun:pending-invites:v1";
export function pendingInvites(): PendingInvite[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(PENDING_KEY) || "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter((p): p is PendingInvite => {
        if (!p || typeof p !== "object") return false;
        return (
          typeof p.wallet === "string" &&
          isAddress(p.wallet, { strict: false }) &&
          typeof p.hash === "string" &&
          /^0x[\da-f]{64}$/i.test(p.hash) &&
          typeof p.ref === "string" &&
          /^[a-z0-9_]{1,15}$/.test(p.ref)
        );
      })
      .slice(-20);
  } catch {
    return [];
  }
}
export function rememberInvite(pending: PendingInvite) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify([
        ...pendingInvites().filter(
          (p) => p.wallet.toLowerCase() !== pending.wallet.toLowerCase(),
        ),
        pending,
      ]),
    );
  } catch {
    /* retry still available for this session */
  }
}
export function removePending(wallet: string) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify(
        pendingInvites().filter(
          (p) => p.wallet.toLowerCase() !== wallet.toLowerCase(),
        ),
      ),
    );
  } catch {
    /* no shared counts are stored in the browser */
  }
}
export function referral(): string | null {
  try {
    const value = new URLSearchParams(location.search).get("ref");
    return value ? normalizeHandle(value) : null;
  } catch {
    return null;
  }
}

export function useInviteActions() {
  const { address } = useConnection();
  const { signMessageAsync } = useSignMessage();
  const sign = async (
    action: "register" | "attribute",
    handle: string,
    hash?: Hash,
  ) => {
    if (!address)
      throw new Error("Connect the wallet that will use this invite handle.");
    const challenge = await inviteApi<Challenge>("/challenge", {
      wallet: address,
      action,
      handle,
      txHash: hash,
    });
    const signature = await signMessageAsync({ message: challenge.message });
    return inviteApi<{
      handle: string;
      count?: number;
      credited?: boolean;
      alreadyCredited?: boolean;
    }>(`/${action}`, { challengeId: challenge.id, signature });
  };
  return {
    register: (handle: string) => sign("register", handle),
    attribute: async (pending: PendingInvite) => {
      if (address?.toLowerCase() !== pending.wallet.toLowerCase())
        throw new Error(
          "Reconnect the wallet that minted this HAM to save invite credit.",
        );
      const result = await sign("attribute", pending.ref, pending.hash);
      removePending(pending.wallet);
      return result;
    },
  };
}

export function InvitePanel({
  connect,
  pending,
  onCredited,
}: {
  connect: () => void;
  pending: PendingInvite | null;
  onCredited: () => void;
}) {
  const { address } = useConnection();
  const actions = useInviteActions();
  const health = useQuery({
    queryKey: ["invite-health"],
    queryFn: () => inviteApi<{ ok: boolean }>("/health"),
    retry: false,
    staleTime: 30_000,
  });
  const [handle, setHandle] = useState("");
  const [link, setLink] = useState("");
  const [registered, setRegistered] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setRegistered(false);
    setLink("");
    setMessage("");
  }, [address]);
  return (
    <section className="invite-layout">
      <div className="invite-art">
        <img src="./hamster.svg" width="160" height="160" alt="" />
        <h1>Bring your running buddies.</h1>
        <p>Invite a friend to mint their first HAM.</p>
        <div className="invite-steps">
          <span>Share a link</span>
          <span aria-hidden="true">→</span>
          <span>Friend mints</span>
          <span aria-hidden="true">→</span>
          <span>Invite counts</span>
        </div>
      </div>
      <div className="panel invite-form">
        <h2>A little bigger crew.</h2>
        <p>
          Successful mints count on the off-chain invite board. No on-chain
          referral rewards.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setMessage("");
            setBusy(true);
            try {
              const normalized = normalizeHandle(handle);
              setHandle(normalized);
              setLink(shareLink(normalized));
              if (health.data?.ok && address) {
                await actions.register(normalized);
                setRegistered(true);
                setMessage("Handle registered. Your link is ready to share.");
              } else {
                setRegistered(false);
                setMessage(
                  health.data?.ok
                    ? "Link created. Connect and register this handle before sharing for credit."
                    : "Link created. Register this handle when the invite service is online so mints can count.",
                );
              }
            } catch (e) {
              setError(readableError(e));
              input.current?.focus();
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="x-handle">Your X handle</label>
          <div className="handle-input">
            <span aria-hidden="true">@</span>
            <input
              ref={input}
              id="x-handle"
              name="x-handle"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={16}
              placeholder="your_handle"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setRegistered(false);
                setLink("");
                setError("");
              }}
              aria-describedby="handle-hint handle-error"
              aria-invalid={Boolean(error)}
            />
          </div>
          <p id="handle-hint" className="small muted">
            1–15 letters, numbers, or underscores. Handles are self-reported; X
            ownership is not verified.
          </p>
          <button className="button primary full" disabled={busy}>
            {busy
              ? "Confirm the signature…"
              : link && !registered && address && health.data?.ok
                ? "Register handle"
                : "Create invite link"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <p id="handle-error" role="status" className="error-text">
          {error}
        </p>
        <p role="status" className="small">
          {message}
        </p>
        {link && (
          <div className="share-result">
            <label htmlFor="invite-link">
              Your invite link
              {registered ? " · registered" : " · not registered"}
            </label>
            <input
              id="invite-link"
              value={link}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <div className="button-row">
              <button
                className="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setMessage("Invite link copied.");
                  } catch {
                    setMessage("Select the link above and copy it.");
                  }
                }}
              >
                Copy link
              </button>
              <a
                className="button"
                target="_blank"
                rel="noopener noreferrer"
                href={`https://x.com/intent/tweet?text=${encodeURIComponent("Meet your little running buddy on HamsterRun. Sepolia testnet only.")}&url=${encodeURIComponent(link)}`}
              >
                Share on X ↗
              </a>
            </div>
          </div>
        )}
        {!address && (
          <button className="text-button" onClick={connect}>
            Connect to register your handle →
          </button>
        )}
        <div className="service-status">
          <span className={`status-dot ${health.data?.ok ? "good" : ""}`} />
          <span className="small">
            {health.isPending
              ? "Checking invite service…"
              : health.data?.ok
                ? "Invite service online · persistent mint counts"
                : "Invite service offline · links need registration before credit"}
          </span>
          <button
            className="text-button"
            onClick={() => health.refetch()}
            disabled={health.isFetching}
          >
            Retry
          </button>
        </div>
        {pending && (
          <div className="credit-pending">
            <h3>Save your friend’s invite</h3>
            <p className="small">
              Your mint succeeded. Sign a free message to credit @{pending.ref}.
              Minting never depends on this signature.
            </p>
            <button
              className="button"
              disabled={busy || !address || !health.data?.ok}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const credit = await actions.attribute(pending);
                  setMessage(
                    credit.alreadyCredited
                      ? `This wallet was already credited to @${credit.handle}.`
                      : `Invite credited to @${credit.handle}. Thanks for growing the crew.`,
                  );
                  onCredited();
                } catch (e) {
                  setError(readableError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save invite credit
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function InviteLeaderboard() {
  const q = useQuery({
    queryKey: ["invite-board"],
    queryFn: () =>
      inviteApi<{ entries: { handle: string; count: number }[] }>(
        "/leaderboard",
      ),
    retry: false,
    refetchInterval: 30_000,
  });
  return (
    <div className="panel">
      <div className="section-heading">
        <div>
          <h2>The bigger-crew board</h2>
          <p className="small muted">Off-chain · successful invited mints</p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh invite leaderboard"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          ↻
        </button>
      </div>
      {q.isPending ? (
        <p className="empty-state">Loading the invite board…</p>
      ) : q.isError ? (
        <div className="empty-state">
          <h3>The invite board is offline.</h3>
          <p>
            Shared counts need the invite service. Retry when it is available.
          </p>
          <button className="button" onClick={() => q.refetch()}>
            Retry invite board
          </button>
        </div>
      ) : q.data.entries.length ? (
        <table>
          <caption className="sr-only">
            Invite leaderboard, ranked by verified successful mints
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Handle</th>
              <th scope="col">Mints</th>
            </tr>
          </thead>
          <tbody>
            {q.data.entries.map((entry, i) => (
              <tr key={entry.handle}>
                <td>{i + 1}</td>
                <th scope="row">@{entry.handle}</th>
                <td>{entry.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty-state">
          <h3>A fresh starting line.</h3>
          <p>
            No successful invited mints yet. Register your handle, then share
            your link.
          </p>
          <a className="button" href="#invites">
            Create an invite
          </a>
        </div>
      )}
      <p className="small muted">
        One credit per minting wallet. Self-invites do not count. These counts
        are separate from SeasonBoard and never award points.
      </p>
    </div>
  );
}
