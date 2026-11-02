import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWalletClient } from "wagmi";
import { decodeEventLog, type Hash, type TransactionReceipt } from "viem";
import {
  abi,
  addresses,
  board,
  booking,
  chain,
  client,
  explorer,
  read,
  readableError,
  snapshot,
  walletData,
  type Booking,
  type ContractName,
  type Core,
  type Pet,
  type Race,
} from "./chain";
import { fmt, integer, trainState, validStart } from "./game";
import { Wallet } from "./Wallet";
import {
  InviteLeaderboard,
  InvitePanel,
  pendingInvites,
  referral,
  rememberInvite,
  removePending,
  useInviteActions,
  type PendingInvite,
} from "./Invites";

type View = "play" | "invites" | "leaderboards";
type Notice = { where: string; text: string; error?: boolean; hash?: Hash };
type Send = (
  where: string,
  contract: ContractName,
  method: string,
  args?: readonly unknown[],
) => Promise<TransactionReceipt | undefined>;
const currentView = (): View =>
  ["invites", "leaderboards"].includes(location.hash.slice(1))
    ? (location.hash.slice(1) as View)
    : "play";

export default function App() {
  const [view, setView] = useState<View>(currentView);
  const [openSignal, setOpenSignal] = useState(0);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const { address, chainId, isConnected } = useConnection();
  const { data: wallet } = useWalletClient();
  const queries = useQueryClient();
  const [pending, setPending] = useState<PendingInvite | null>(null);
  const invites = useInviteActions();
  const snap = useQuery({
    queryKey: ["snapshot"],
    queryFn: snapshot,
    refetchInterval: 20_000,
  });
  const owned = useQuery({
    queryKey: ["owned", address],
    queryFn: () => walletData(address!, snap.data!.supply, snap.data!.block),
    enabled: Boolean(address && snap.data && !snap.isError),
    refetchInterval: 30_000,
  });
  const fresh = Boolean(
    snap.data && !snap.isError && Date.now() - snap.data.checkedAt < 60_000,
  );
  const core = fresh ? (snap.data?.core ?? null) : null;
  const canTransact = Boolean(
    isConnected && wallet && chainId === chain.id && fresh && !busy,
  );
  const canWrite = canTransact && Boolean(snap.data?.wired);
  const selectedPet =
    fresh && !owned.isError
      ? owned.data?.pets.find((p) => p.id === selected)
      : undefined;
  const connect = () => setOpenSignal((n) => n + 1);
  useEffect(() => {
    const onHash = () => setView(currentView());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (
      owned.data?.pets.length &&
      !owned.data.pets.some((p) => p.id === selected)
    )
      setSelected(owned.data.pets[0].id);
    if (owned.data && !owned.data.pets.length) setSelected(null);
  }, [owned.data, selected]);
  useEffect(() => {
    setSelected(null);
    setNotice(null);
    setPending(
      address
        ? (pendingInvites().find(
            (p) => p.wallet.toLowerCase() === address.toLowerCase(),
          ) ?? null)
        : null,
    );
  }, [address]);

  const send: Send = async (where, name, functionName, args = []) => {
    const allowed =
      name === "HamsterRunNFT" && functionName === "mint"
        ? canTransact
        : canWrite;
    if (!address || !wallet || !allowed || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice({ where, text: "Checking the transaction on Sepolia…" });
    let hash: Hash | undefined;
    try {
      if ((await wallet.getChainId()) !== chain.id)
        throw new Error("Switch your wallet to Sepolia before continuing.");
      const accounts = await wallet.getAddresses();
      if (accounts[0]?.toLowerCase() !== address.toLowerCase())
        throw new Error(
          "Your wallet account changed. Reconnect before continuing.",
        );
      const { request } = await client.simulateContract({
        address: addresses[name],
        abi: abi(name),
        functionName,
        args,
        account: address,
      });
      setNotice({
        where,
        text: "Confirm in your wallet. Free action; Sepolia gas is required.",
      });
      hash = await wallet.writeContract({
        ...request,
        chain,
        account: address,
      });
      setNotice({
        where,
        text: "Transaction sent. Waiting for confirmation…",
        hash,
      });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations:
          name === "HamsterRunNFT" && functionName === "mint" ? 2 : 1,
        timeout: 120_000,
      });
      if (receipt.status !== "success")
        throw new Error(
          "The transaction reverted. Check its explorer receipt, then refresh and retry.",
        );
      setNotice({
        where,
        text: "Confirmed on Sepolia.",
        hash: receipt.transactionHash,
      });
      await queries.invalidateQueries({ queryKey: ["snapshot"] });
      await queries.invalidateQueries({ queryKey: ["owned"] });
      await queries.invalidateQueries({ queryKey: ["booking"] });
      await queries.invalidateQueries({ queryKey: ["race"] });
      await queries.invalidateQueries({ queryKey: ["season"] });
      return receipt;
    } catch (error) {
      setNotice({ where, text: readableError(error), error: true, hash });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const mint = async () => {
    if (!address) {
      connect();
      return;
    }
    const mintingWallet = address;
    const receipt = await send("mint", "HamsterRunNFT", "mint");
    if (!receipt) return;
    const ref = referral();
    if (ref) {
      const p: PendingInvite = {
        wallet: mintingWallet,
        hash: receipt.transactionHash,
        ref,
      };
      rememberInvite(p);
      setPending(p);
      try {
        const credit = await invites.attribute(p);
        setPending(null);
        setNotice({
          where: "mint",
          text: `Mint confirmed. ${credit.alreadyCredited ? "This wallet was already credited to" : "Invite credited to"} @${credit.handle}.`,
          hash: receipt.transactionHash,
        });
      } catch (e) {
        const reason = readableError(e);
        if (reason.includes("Self-invites")) {
          removePending(mintingWallet);
          setPending(null);
          setNotice({
            where: "mint",
            text: "Mint confirmed. Self-invites do not count.",
            hash: receipt.transactionHash,
          });
        } else
          setNotice({
            where: "mint",
            text: `Mint confirmed. Invite credit is pending: ${reason} Open Invite friends to retry.`,
            hash: receipt.transactionHash,
          });
      }
    }
  };

  const mintClosed = fresh && snap.data?.mintOpen === false;
  const mintDisabled =
    !fresh ||
    mintClosed ||
    Boolean(owned.data?.publicMinted) ||
    (snap.data?.supply ?? 0n) >= 10000n ||
    busy ||
    Boolean(address && (!canTransact || owned.isPending || owned.isError));
  const noticeAt = (where: string) => (
    <TransactionNotice notice={notice?.where === where ? notice : null} />
  );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to game
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a href="#" className="brand" aria-label="HamsterRun home">
            <img src="./hamster.svg" width="37" height="37" alt="" />
            <span>HamsterRun</span>
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <NavLinks view={view} />
          </nav>
          <div className="header-actions">
            <span className="network-label">
              <span className="status-dot good" />
              Sepolia
            </span>
            <Wallet openSignal={openSignal} />
          </div>
        </div>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <NavLinks view={view} />
        </nav>
      </header>
      <div className="page">
        <CoreBanner
          core={core}
          loading={snap.isPending}
          unavailable={snap.isError}
          identityError={snap.data?.coreError}
          refresh={() => snap.refetch()}
          refreshing={snap.isFetching}
        />
        <main id="main" tabIndex={-1}>
          {view === "play" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Small paws. Big adventures.</h1>
                  <p>A little hamster game on Sepolia.</p>
                </div>
                <a href="#how-to-play" className="text-button">
                  How to play <span aria-hidden="true">↓</span>
                </a>
              </div>
              <section className="welcome" aria-label="Mint your hamster">
                <div className="meadow">
                  <img
                    src="./meadow.svg"
                    width="800"
                    height="430"
                    alt="Two pixel hamsters in a mint green meadow, ready for a run"
                  />
                  <span className="scene-caption">
                    <span className="status-dot good" />A tiny world. A fresh
                    start.
                  </span>
                </div>
                <div className="mint-panel">
                  <div className="section-heading">
                    <h2>Meet your first HAM.</h2>
                    <span className="tag peach">Free mint</span>
                  </div>
                  <p>
                    One little buddy per wallet.
                    <br /> Train together. Race your friends.
                  </p>
                  <div className="mint-supply">
                    <span>Hamsters minted</span>
                    <strong>
                      {fresh ? fmt(snap.data?.supply) : "—"}{" "}
                      <span>/ 10,000</span>
                    </strong>
                  </div>
                  <div
                    className="supply-track"
                    role="img"
                    aria-label={
                      fresh
                        ? `${fmt(snap.data?.supply)} of 10,000 minted`
                        : "Supply unavailable"
                    }
                  >
                    <span
                      style={{
                        width: fresh
                          ? `${Number(snap.data?.supply ?? 0n) / 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <button
                    className="button primary full mint-button"
                    disabled={mintDisabled}
                    onClick={mint}
                  >
                    {busy && notice?.where === "mint"
                      ? "Minting…"
                      : owned.data?.publicMinted
                        ? "Your HAM is already minted"
                        : mintClosed
                          ? "Mint closed"
                          : snap.isError
                            ? "Mint unavailable"
                            : !fresh
                              ? "Checking mint…"
                              : "Mint a hamster"}
                    <span aria-hidden="true">{mintClosed ? "▦" : "→"}</span>
                  </button>
                  <p className="mint-help small">
                    {mintClosed
                      ? "Mint closed / owner wiring pending"
                      : fresh && !snap.data?.wired
                        ? "Mint open. Training and race wiring pending."
                        : snap.isError
                          ? "Refresh to check mint status."
                          : owned.data?.publicMinted
                            ? "One lifetime public mint per wallet."
                            : "0 ETH mint price · Sepolia gas only"}
                  </p>
                  <div className="mint-state small">
                    <span className="muted">mintOpen</span>
                    <code>
                      {fresh ? String(snap.data?.mintOpen) : "unknown"}
                    </code>
                    <span className="tag">Testnet only</span>
                  </div>
                  {noticeAt("mint")}
                  {referral() && (
                    <p className="small muted">
                      Invited by @{referral()}. Credit needs their registered
                      handle and your signed mint confirmation.
                    </p>
                  )}
                </div>
              </section>
              <section className="pets-section" aria-labelledby="pets-heading">
                <div className="section-heading">
                  <div>
                    <h2 id="pets-heading">Your little lineup</h2>
                    <p className="small muted">
                      Stamina stays with your HAM. Points stay with your wallet.
                    </p>
                  </div>
                  <div className="points-pill">
                    <Star />
                    <span>
                      Address points{" "}
                      <strong>
                        {address && fresh && !owned.isError
                          ? fmt(owned.data?.points)
                          : "—"}
                      </strong>
                    </span>
                  </div>
                </div>
                {!address ? (
                  <div className="lineup-empty">
                    <img src="./hamster.svg" width="54" height="54" alt="" />
                    <p>Connect your wallet to find your HAMs.</p>
                    <button className="button" onClick={connect}>
                      Find my hamsters →
                    </button>
                  </div>
                ) : !fresh && !snap.isPending ? (
                  <div className="lineup-empty">
                    <p>Wallet reads paused. Refresh Sepolia to retry.</p>
                    <button className="button" onClick={() => snap.refetch()}>
                      Retry Sepolia reads
                    </button>
                  </div>
                ) : owned.isPending ? (
                  <p className="lineup-empty">
                    Checking owned HAMs and Stamina…
                  </p>
                ) : owned.isError ? (
                  <div className="lineup-empty">
                    <p>Owned HAMs could not be loaded.</p>
                    <button className="button" onClick={() => owned.refetch()}>
                      Retry wallet reads
                    </button>
                  </div>
                ) : !owned.data?.pets.length ? (
                  <div className="lineup-empty">
                    <img src="./hamster.svg" width="54" height="54" alt="" />
                    <p>
                      No HAMs in this wallet yet. Mint your first buddy above
                      when minting opens.
                    </p>
                  </div>
                ) : (
                  <div
                    className="pet-list"
                    role="group"
                    aria-label="Choose an owned HAM"
                  >
                    {owned.data.pets.map((pet) => (
                      <button
                        className={`pet-choice ${selected === pet.id ? "selected" : ""}`}
                        key={pet.id.toString()}
                        aria-pressed={selected === pet.id}
                        onClick={() => setSelected(pet.id)}
                      >
                        <img
                          src="./hamster.svg"
                          width="60"
                          height="60"
                          alt=""
                        />
                        <span>
                          <strong>HAM #{pet.id.toString()}</strong>
                          <span className="small">
                            Stamina {fmt(pet.stamina)} / 10,000
                          </span>
                          <span className="small muted">
                            {pet.locked
                              ? "Race locked"
                              : `Band ${Number((pet.stamina >= 10000n ? 9999n : pet.stamina) / 2000n) + 1}`}
                          </span>
                        </span>
                        <span className="selection-mark" aria-hidden="true">
                          {selected === pet.id ? "✓" : "+"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <div className="game-grid">
                <Training
                  pet={selectedPet}
                  core={core}
                  canWrite={canWrite && !owned.isError}
                  wiringPending={fresh && !snap.data?.wired}
                  send={send}
                  notice={noticeAt("training")}
                />
                <Racing
                  pet={selectedPet}
                  core={core}
                  address={address}
                  canWrite={canWrite && !owned.isError}
                  wiringPending={fresh && !snap.data?.wired}
                  send={send}
                  notice={noticeAt("race")}
                />
              </div>
              <section id="how-to-play" className="how-section">
                <div>
                  <h2>A good day for a little run.</h2>
                  <p className="muted">
                    Mint a HAM, pick a future training window, then return when
                    Core has certified it.
                  </p>
                </div>
                <ol className="how-steps">
                  <li>
                    <span>01</span>
                    <h3>Meet your buddy</h3>
                    <p>
                      Mint once per wallet for free. You’ll only need Sepolia
                      ETH for gas.
                    </p>
                  </li>
                  <li>
                    <span>02</span>
                    <h3>Book a little training</h3>
                    <p>
                      Choose six future rounds in the current Core day. Settle
                      after certification for Stamina.
                    </p>
                  </li>
                  <li>
                    <span>03</span>
                    <h3>Run with a friend</h3>
                    <p>
                      Challenge a HAM in your Stamina band. Race for wallet
                      points and a weekly score.
                    </p>
                  </li>
                </ol>
              </section>
            </>
          )}
          {view === "invites" && (
            <InvitePanel
              connect={connect}
              pending={pending}
              onCredited={() => {
                setPending(null);
                queries.invalidateQueries({ queryKey: ["invite-board"] });
              }}
            />
          )}
          {view === "leaderboards" && (
            <Leaderboards
              core={core}
              canWrite={canWrite}
              pet={selectedPet}
              send={send}
              notice={noticeAt("board")}
            />
          )}
        </main>
        <footer className="site-footer">
          <div>
            <a className="brand" href="#">
              <img src="./hamster.svg" width="28" height="28" alt="" />
              <span>HamsterRun</span>
            </a>
            <p className="small muted">
              An independent Sepolia demo. No real SQK, mining rights, sensors,
              or insurance. Points have no monetary value and cannot be
              transferred.
            </p>
          </div>
          <details>
            <summary>Contracts & testnet details</summary>
            <ul>
              {Object.entries(addresses).map(([name, address]) => (
                <li key={name}>
                  <a
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`${explorer}/address/${address}`}
                  >
                    {name} ↗
                  </a>
                  <code className="break-address">{address}</code>
                </li>
              ))}
            </ul>
            <p className="small">
              Chain 11155111 · 600-second rounds · six rounds per training
              window.{" "}
              <a
                href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get testnet ETH ↗
              </a>
            </p>
          </details>
        </footer>
      </div>
    </>
  );
}

function NavLinks({ view }: { view: View }) {
  return (
    <>
      {(
        [
          ["play", "Play"],
          ["invites", "Invite friends"],
          ["leaderboards", "Leaderboards"],
        ] as const
      ).map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={view === id ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </>
  );
}
function Star() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m12 3 2.6 5.7 6.2.7-4.6 4.2 1.3 6.1-5.5-3-5.5 3 1.3-6.1-4.6-4.2 6.2-.7Z" />
    </svg>
  );
}
function TransactionNotice({ notice }: { notice: Notice | null }) {
  return (
    <div
      className={`transaction-notice small ${notice?.error ? "error-text" : ""}`}
      role="status"
    >
      {notice && (
        <>
          {notice.text}
          {notice.hash && (
            <>
              {" "}
              <a
                href={`${explorer}/tx/${notice.hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View transaction ↗
              </a>
            </>
          )}
        </>
      )}
    </div>
  );
}
function CoreBanner({
  core,
  loading,
  unavailable,
  identityError,
  refresh,
  refreshing,
}: {
  core: Core | null;
  loading: boolean;
  unavailable: boolean;
  identityError?: string;
  refresh: () => void;
  refreshing: boolean;
}) {
  const unknown = unavailable || !core;
  return (
    <aside
      className={`core-banner ${!loading && (unknown || core?.paused || !core?.identity) ? "core-warning" : ""}`}
      aria-label="Core certification status"
    >
      <div className="core-icon" aria-hidden="true">
        {loading
          ? "◷"
          : unknown || core?.paused || !core?.identity
            ? "!"
            : core?.lag
              ? "◷"
              : "✓"}
      </div>
      <div className="core-copy">
        <strong>
          {loading
            ? "Checking Core’s frontier…"
            : unknown
              ? "Core unavailable · work unknown"
              : !core.identity
                ? "Core identity changed · settlement deferred"
                : core.paused
                  ? "Core paused · training deferred"
                  : core.lag > 0n
                    ? "Core is catching up"
                    : "Core is up to date"}
        </strong>
        <p className="small">
          {loading
            ? "Uncertified rounds stay unknown."
            : unknown
              ? "Refresh to check Core; uncertified rounds stay unknown."
              : `Certified through ${fmt(core.frontier)} · current round ${fmt(core.current)} · ${fmt(core.lag)} closed rounds unknown`}
        </p>
        <details>
          <summary className="small">What this means</summary>
          <p className="small">
            {unknown
              ? identityError || "No current Core snapshot is available."
              : !core.identity
                ? "The adapter’s pinned Core checks are failing. Work settlement is disabled for review."
                : core.paused
                  ? "Core is paused. Bookings remain pending until it resumes and certifies their full window."
                  : "Training only settles when the full six-round window is certified. Uncertified work is never counted as zero."}{" "}
            {core && `Snapshot: Sepolia block ${core.block}.`}
          </p>
        </details>
      </div>
      <button
        className="icon-button"
        aria-label="Refresh Sepolia state"
        onClick={refresh}
        disabled={refreshing}
      >
        ↻
      </button>
    </aside>
  );
}

function Training({
  pet,
  core,
  canWrite,
  wiringPending,
  send,
  notice,
}: {
  pet?: Pet;
  core: Core | null;
  canWrite: boolean;
  wiringPending: boolean;
  send: Send;
  notice: React.ReactNode;
}) {
  const [start, setStart] = useState("");
  const [day, setDay] = useState<string | undefined>();
  const [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (core && !initialized.current) {
      setStart((core.current + 2n).toString());
      initialized.current = true;
    }
  }, [core]);
  const parsedDay = (() => {
    try {
      return integer(day ?? core?.day.toString() ?? "");
    } catch {
      return null;
    }
  })();
  const b = useQuery({
    queryKey: [
      "booking",
      pet?.id.toString(),
      parsedDay?.toString(),
      core?.block.toString(),
    ],
    queryFn: () => booking(pet!.id, parsedDay!, core?.block),
    enabled: Boolean(pet && parsedDay !== null),
  });
  const status = b.data ? trainState(b.data, core) : null;
  const last = core ? core.day * 144n + 139n : null;
  const hasWindow = Boolean(core && last !== null && core.current < last);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (!core || !pet)
        throw new Error("Select an owned HAM and refresh Core first.");
      const first = integer(start, 1n);
      if (!validStart(core, first))
        throw new Error(
          `Choose a first round from ${core.current + 1n} to ${last}, within Core day ${core.day}.`,
        );
      await send("training", "TrainBook", "book", [pet.id, first]);
    } catch (e) {
      setError(readableError(e));
      field.current?.focus();
    }
  };
  return (
    <section className="panel training-panel">
      <div className="section-heading">
        <h2>A little daily training</h2>
        <span className="tag mint">6 rounds</span>
      </div>
      <p className="muted">
        {wiringPending
          ? "Owner wiring pending. Training is not open yet."
          : pet
            ? `HAM #${pet.id} is ready to plan a run.`
            : "Select an owned HAM to book a run."}
      </p>
      <form onSubmit={submit}>
        <label htmlFor="start-round">First round</label>
        <div className="inline-form">
          <input
            ref={field}
            id="start-round"
            name="start-round"
            inputMode="numeric"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setError("");
            }}
            placeholder="Future round"
            aria-invalid={Boolean(error)}
            aria-describedby="window-hint train-error"
          />
          <button
            className="button primary"
            disabled={
              !canWrite ||
              !pet ||
              !hasWindow ||
              (b.data?.start !== 0n &&
                parsedDay === core?.day &&
                Boolean(b.data))
            }
          >
            Book training →
          </button>
        </div>
        <p id="window-hint" className="small muted">
          {core
            ? hasWindow
              ? `Start ${core.current + 1n}–${last}. All six rounds must fit in day ${core.day}. One booking per HAM per Core day.`
              : "No full future window fits today. Try again next Core day."
            : "Future rounds unavailable until Core can be read."}
        </p>
        <p id="train-error" className="error-text small" role="status">
          {error}
        </p>
      </form>
      <div className="training-history">
        <div className="section-heading">
          <h3>Booked training</h3>
          <div className="day-input">
            <label htmlFor="train-day">Core day</label>
            <input
              id="train-day"
              inputMode="numeric"
              name="train-day"
              value={day ?? core?.day.toString() ?? ""}
              onChange={(e) => setDay(e.target.value)}
              aria-describedby="day-hint"
            />
          </div>
        </div>
        <p id="day-hint" className="small muted">
          Inspect an earlier day to settle a pending booking.
        </p>
        {!pet ? (
          <p className="empty-inline">Your next adventure starts with a HAM.</p>
        ) : parsedDay === null ? (
          <p className="error-text small">Enter a valid Core day.</p>
        ) : b.isPending ? (
          <p className="empty-inline">Checking this day’s booking…</p>
        ) : b.isError ? (
          <div className="empty-inline">
            <p>Booking unavailable. Work is unknown.</p>
            <button className="text-button" onClick={() => b.refetch()}>
              Retry booking
            </button>
          </div>
        ) : (
          b.data && <BookingView b={b.data} core={core} />
        )}
        <button
          className="button full"
          disabled={!canWrite || !pet || status !== "ready"}
          onClick={() =>
            pet &&
            b.data &&
            send("training", "TrainBook", "settle", [pet.id, b.data.day])
          }
        >
          {status === "settled"
            ? "Training settled"
            : status === "unknown"
              ? "Waiting for certification"
              : status === "paused"
                ? "Core paused"
                : status === "identity"
                  ? "Core review needed"
                  : "Settle certified training"}
        </button>
      </div>
      {notice}
      <p className="small muted">
        Stamina comes from certified physical work. Round work is never
        estimated.
      </p>
    </section>
  );
}
function BookingView({ b, core }: { b: Booking; core: Core | null }) {
  const status = trainState(b, core);
  if (status === "empty")
    return (
      <p className="empty-inline">
        No window booked for day {b.day.toString()}.
      </p>
    );
  return (
    <div className="booking-view">
      <div className="rounds" aria-label="Six booked rounds">
        {Array.from({ length: 6 }, (_, i) => {
          const r = b.start + BigInt(i),
            certified = Boolean(core?.identity && r <= core.frontier);
          return (
            <div
              className={`round ${certified || b.settled ? "certified" : ""}`}
              key={i}
            >
              <span className="small">#{r.toString()}</span>
              <span className="small">
                {b.settled || certified ? "Certified" : "Unknown"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="small">
        {b.settled
          ? `Settled · ${fmt(b.work)} certified trainWork`
          : status === "ready"
            ? "The whole window is certified. Settle to record the work."
            : status === "paused"
              ? "Core is paused. This booking stays pending."
              : status === "identity"
                ? "Core pin check failed. Settlement needs review."
                : "Work is unknown until the whole window is certified."}
      </p>
    </div>
  );
}

function Racing({
  pet,
  core,
  address,
  canWrite,
  wiringPending,
  send,
  notice,
}: {
  pet?: Pet;
  core: Core | null;
  address?: `0x${string}`;
  canWrite: boolean;
  wiringPending: boolean;
  send: Send;
  notice: React.ReactNode;
}) {
  const [opponent, setOpponent] = useState("");
  const [matchId, setMatchId] = useState("");
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState<bigint | null>(null);
  const race = useQuery({
    queryKey: ["race", lookup?.toString(), core?.block.toString()],
    queryFn: () => read<Race>("MatchBook", "races", [lookup], core?.block),
    enabled: lookup !== null,
  });
  const active = useQuery({
    queryKey: ["active-race", pet?.id.toString(), core?.block.toString()],
    queryFn: () =>
      read<bigint>("MatchBook", "activeMatch", [pet!.id], core?.block),
    enabled: Boolean(pet),
  });
  useEffect(() => {
    if (active.data && active.data > 0n) {
      setLookup(active.data);
      setMatchId(active.data.toString());
    }
  }, [active.data]);
  const data = race.isError ? undefined : race.data;
  const seedSaved = data ? BigInt(data.seed) !== 0n : false;
  const hashAvailable = Boolean(
    data &&
    core &&
    core.block > data.randomBlock &&
    core.block <= data.randomBlock + 256n,
  );
  const ready = Boolean(
    data?.state === 2 &&
    core &&
    core.timestamp >= data.readyAt &&
    (seedSaved || hashAvailable),
  );
  const expired = Boolean(
    data &&
    core &&
    ((data.state === 1 && core.timestamp >= data.offeredAt + 3600n) ||
      (data.state === 2 && !seedSaved && core.block > data.randomBlock + 256n)),
  );
  const challenge = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (!pet) throw new Error("Select an owned HAM first.");
      const second = integer(opponent, 1n, 10000n);
      if (second === pet.id)
        throw new Error("Choose a HAM owned by another wallet.");
      const receipt = await send("race", "MatchBook", "challenge", [
        pet.id,
        second,
      ]);
      if (receipt)
        for (const log of receipt.logs) {
          try {
            const event = decodeEventLog({
              abi: abi("MatchBook"),
              data: log.data,
              topics: log.topics,
            });
            if (event.eventName === "Challenged") {
              const id = (event.args as unknown as { matchId: bigint }).matchId;
              setMatchId(id.toString());
              setLookup(id);
            }
          } catch {
            /* logs from other contracts */
          }
        }
    } catch (e) {
      setError(readableError(e));
    }
  };
  return (
    <section className="panel race-panel">
      <div className="section-heading">
        <h2>A friendly 1v1</h2>
        <span className="tag lilac">Optional</span>
      </div>
      <p className="muted">
        {wiringPending
          ? "Owner wiring pending. Racing is not open yet."
          : "A little competition, a lot of tiny feet."}
      </p>
      <form onSubmit={challenge}>
        <label htmlFor="opponent">Opponent HAM ID</label>
        <div className="inline-form">
          <input
            id="opponent"
            inputMode="numeric"
            name="opponent"
            placeholder="Their HAM number"
            value={opponent}
            onChange={(e) => {
              setOpponent(e.target.value);
              setError("");
            }}
            aria-describedby="race-hint race-error"
          />
          <button
            className="button"
            disabled={!canWrite || !pet || pet.locked || !core}
          >
            Challenge →
          </button>
        </div>
        <p id="race-hint" className="small muted">
          Same Stamina band, different owner. Five accepted races per HAM and
          wallet each week. 24-hour rematch cooldown.
        </p>
      </form>
      <div className="race-track" aria-hidden="true">
        <span className="track-ham">
          <img src="./hamster.svg" width="48" height="48" alt="" />
        </span>
        <span className="track-ham second">
          <img src="./hamster.svg" width="48" height="48" alt="" />
        </span>
        <span className="finish-line" />
      </div>
      <div className="match-lookup">
        <label htmlFor="match-id">Match ID</label>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const id = integer(matchId, 1n);
              setLookup(id);
              setError("");
              race.refetch();
            } catch (e) {
              setError(readableError(e));
            }
          }}
        >
          <input
            id="match-id"
            name="match-id"
            inputMode="numeric"
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
            placeholder="Enter a match ID"
          />
          <button className="button" type="submit">
            Load race
          </button>
        </form>
      </div>
      <p id="race-error" role="status" className="error-text small">
        {error}
      </p>
      {lookup === null ? (
        <p className="small muted">
          Challenge a friend, then share the match ID so they can accept.
        </p>
      ) : race.isPending ? (
        <p>Loading race…</p>
      ) : race.isError ? (
        <p className="error-text small">
          Race unavailable. Load the match again to retry.
        </p>
      ) : (
        data && (
          <div className="race-status">
            <h3>
              Match #{lookup.toString()} ·{" "}
              {
                [
                  "Not found",
                  "Offered",
                  "Running",
                  "Settled",
                  "Cancelled",
                  "Expired",
                ][data.state]
              }
            </h3>
            {data.state > 0 && (
              <p className="small">
                HAM #{data.first.toString()} vs #{data.second.toString()} · week{" "}
                {data.week.toString()}
              </p>
            )}
            {data.state === 1 && (
              <>
                <p className="small muted">
                  Send match #{lookup.toString()} to the other owner. Offers
                  expire after one hour or at week end. Challenging locks your
                  HAM until resolved.
                </p>
                <div className="button-row">
                  <button
                    className="button"
                    disabled={
                      !canWrite ||
                      address?.toLowerCase() !==
                        data.secondOwner.toLowerCase() ||
                      Boolean(
                        core &&
                        (core.week !== data.week ||
                          core.timestamp >= data.offeredAt + 3600n),
                      )
                    }
                    onClick={() =>
                      send("race", "MatchBook", "accept", [lookup])
                    }
                  >
                    Accept challenge
                  </button>
                  <button
                    className="text-button"
                    disabled={
                      !canWrite ||
                      address?.toLowerCase() !== data.firstOwner.toLowerCase()
                    }
                    onClick={() =>
                      send("race", "MatchBook", "cancel", [lookup])
                    }
                  >
                    Cancel challenge
                  </button>
                </div>
              </>
            )}
            {data.state === 2 && (
              <>
                <p className="small muted">
                  {seedSaved
                    ? "Race seed saved."
                    : `Randomness block ${data.randomBlock}; capture before block ${data.randomBlock + 257n}.`}{" "}
                  At least 15 seconds and the future block must pass. Both HAMs
                  are locked.
                </p>
                <div className="button-row">
                  <button
                    className="button"
                    disabled={!canWrite || !ready}
                    onClick={() =>
                      send("race", "MatchBook", "settle", [lookup])
                    }
                  >
                    Settle race
                  </button>
                  <button
                    className="text-button"
                    disabled={!canWrite || seedSaved || !hashAvailable}
                    onClick={() =>
                      send("race", "MatchBook", "captureRandomness", [lookup])
                    }
                  >
                    Save race seed
                  </button>
                </div>
              </>
            )}
            {data.state === 3 && (
              <p>
                HAM #{data.winner.toString()} wins. Distances:{" "}
                {fmt(data.firstDistance)} / {fmt(data.secondDistance)} game
                units.
              </p>
            )}
            {data.state === 5 && (
              <p className="small muted">
                No result or points. HAMs are unlocked; accepted-race quota
                stays consumed.
              </p>
            )}
            {(data.state === 1 || data.state === 2) && (
              <button
                className="text-button"
                disabled={!canWrite || !expired}
                onClick={() => send("race", "MatchBook", "expire", [lookup])}
              >
                Release expired race
              </button>
            )}
          </div>
        )
      )}
      {notice}
    </section>
  );
}

function Leaderboards({
  core,
  canWrite,
  pet,
  send,
  notice,
}: {
  core: Core | null;
  canWrite: boolean;
  pet?: Pet;
  send: Send;
  notice: React.ReactNode;
}) {
  const [which, setWhich] = useState<"season" | "invites">("season");
  const [weekInput, setWeekInput] = useState("");
  const [week, setWeek] = useState<bigint | null>(core?.week ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (core && week === null) setWeek(core.week);
  }, [core, week]);
  const q = useQuery({
    queryKey: ["season", week?.toString(), core?.block.toString()],
    queryFn: () => board(week!, core?.block),
    enabled: week !== null,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Every little run counts.</h1>
          <p>Two boards. Two ways to grow.</p>
        </div>
      </div>
      <div
        className="board-switch"
        role="group"
        aria-label="Choose leaderboard"
      >
        <button
          aria-pressed={which === "season"}
          onClick={() => setWhich("season")}
        >
          Weekly game scores
        </button>
        <button
          aria-pressed={which === "invites"}
          onClick={() => setWhich("invites")}
        >
          Invite mints
        </button>
      </div>
      {which === "invites" ? (
        <InviteLeaderboard />
      ) : (
        <section className="panel season-panel">
          <div className="section-heading">
            <div>
              <h2>The weekly running board</h2>
              <p className="small muted">
                On-chain SeasonBoard ·{" "}
                {q.data?.finalized ? "Finalized" : "Provisional scores"}
              </p>
            </div>
            <form
              className="week-form"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  setWeek(integer(weekInput || core?.week.toString() || ""));
                  setError("");
                } catch (e) {
                  setError(readableError(e));
                }
              }}
            >
              <label htmlFor="board-week">Core week</label>
              <input
                id="board-week"
                name="board-week"
                inputMode="numeric"
                value={weekInput || core?.week.toString() || ""}
                onChange={(e) => setWeekInput(e.target.value)}
              />
              <button className="button">Load</button>
            </form>
          </div>
          <p className="score-formula">
            Week score = trainWork + floor(raceDistance / 100)
          </p>
          <p role="status" className="error-text small">
            {error}
          </p>
          {week === null ? (
            <p className="empty-state">
              Read Core or enter a week to load game scores.
            </p>
          ) : q.isPending ? (
            <p className="empty-state">Loading week {week.toString()}…</p>
          ) : q.isError ? (
            <div className="empty-state">
              <p>Game scores are unavailable.</p>
              <button className="button" onClick={() => q.refetch()}>
                Retry game board
              </button>
            </div>
          ) : q.data?.entries.length ? (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">
                  SeasonBoard scores for Core week {week.toString()}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">HAM</th>
                    <th scope="col">Train work</th>
                    <th scope="col">Race distance</th>
                    <th scope="col">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.entries.map((entry, i) => (
                    <tr key={entry.id.toString()}>
                      <td>{i + 1}</td>
                      <th scope="row">#{entry.id.toString()}</th>
                      <td>{fmt(entry.trainWork)}</td>
                      <td>{fmt(entry.raceDistance)}</td>
                      <td>
                        <strong>{fmt(entry.score)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <img src="./hamster.svg" width="72" height="72" alt="" />
              <h3>The starting line is yours.</h3>
              <p>
                No scored HAMs for this week yet. Settle certified training or
                finish a race to join.
              </p>
              <a className="button" href="#">
                Book a little run →
              </a>
            </div>
          )}
          {q.data && (
            <p className="small muted">
              Week {q.data.week.toString()} · {fmt(q.data.trains)} pending
              trains{q.data.finalized ? " excluded from this board" : ""} ·{" "}
              {fmt(q.data.matches)} pending races. Unknown work is never zeroed.
            </p>
          )}
          <details className="season-actions">
            <summary>Finalize a week & claim point tiers</summary>
            <p className="small muted">
              Finalize after the week ends and all races resolve. Settle pending
              trains first, or wait the two-week grace; excluded trains can
              still gain Stamina later. Point tiers go to the first-activity
              owner for that week.
            </p>
            <div className="button-row">
              <button
                className="button"
                disabled={
                  !canWrite ||
                  week === null ||
                  !q.data ||
                  q.data.finalized ||
                  !core ||
                  core.week <= week
                }
                onClick={() =>
                  week !== null &&
                  send("board", "SeasonBoard", "finalize", [week])
                }
              >
                Finalize week
              </button>
              <button
                className="button"
                disabled={
                  !canWrite || !pet || week === null || !q.data?.finalized
                }
                onClick={() =>
                  pet &&
                  week !== null &&
                  send("board", "SeasonBoard", "claimPrize", [week, pet.id])
                }
              >
                Claim {pet ? `HAM #${pet.id}` : "HAM"} point tier
              </button>
            </div>
          </details>
          {notice}
        </section>
      )}
    </>
  );
}
