import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { decodeEventLog, type Address } from "viem";
import {
  abi,
  addresses,
  inboxPage,
  read,
  readableError,
  rivalsPage,
  type Core,
  type Pet,
  type Race,
  type Snapshot,
} from "./chain";
import {
  bandRange,
  fmt,
  integer,
  matchFromUrl,
  matchLink,
  staminaBand,
} from "./game";
import type { Send } from "./App";

const sameOwner = (a?: string, b?: string) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const matchNumber = (value: string) => integer(value, 1n, (1n << 256n) - 1n);

export function Racing({
  pet,
  core,
  snapshot,
  address,
  canWrite,
  wiringPending,
  send,
  notice,
  connect,
}: {
  pet?: Pet;
  core: Core | null;
  snapshot?: Snapshot;
  address?: Address;
  canWrite: boolean;
  wiringPending: boolean;
  send: Send;
  notice: ReactNode;
  connect: () => void;
}) {
  const [initialMatch] = useState(matchFromUrl);
  const [opponent, setOpponent] = useState("");
  const [matchId, setMatchId] = useState(initialMatch?.toString() ?? "");
  const [lookup, setLookup] = useState<bigint | null>(initialMatch);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState("");
  const [validation, setValidation] = useState("");
  const inspector = useRef<HTMLDivElement>(null);
  const scrolledToLink = useRef(false);
  const followedActive = useRef("");
  const race = useQuery({
    queryKey: ["race", lookup?.toString(), snapshot?.block.toString()],
    queryFn: () => read<Race>("MatchBook", "races", [lookup!], snapshot?.block),
    enabled: lookup !== null && Boolean(snapshot),
  });
  const active = useQuery({
    queryKey: ["active-race", pet?.id.toString(), snapshot?.block.toString()],
    queryFn: () =>
      read<bigint>("MatchBook", "activeMatch", [pet!.id], snapshot?.block),
    enabled: Boolean(pet && snapshot),
  });
  const rivals = useInfiniteQuery({
    queryKey: [
      "rivals",
      address,
      pet?.id.toString(),
      pet?.stamina.toString(),
      snapshot?.supply?.toString(),
    ],
    initialPageParam: 1n,
    queryFn: ({ pageParam }) =>
      rivalsPage(pet!, address!, snapshot!.supply!, snapshot!.block, pageParam),
    getNextPageParam: (last) => last.next,
    enabled: Boolean(address && pet && snapshot?.supply != null),
    refetchInterval: 30_000,
  });
  const inbox = useInfiniteQuery({
    queryKey: ["inbox", address],
    initialPageParam: null as bigint | null,
    queryFn: ({ pageParam }) => inboxPage(address!, snapshot!.block, pageParam),
    getNextPageParam: (last) => last.next,
    enabled: Boolean(address && snapshot),
    refetchInterval: 15_000,
  });
  const focusMatch = (id: bigint, scroll = true) => {
    setMatchId(id.toString());
    setLookup(id);
    setError("");
    setSharing("");
    setValidation("");
    history.replaceState(null, "", matchLink(id));
    if (scroll) inspector.current?.scrollIntoView({ block: "start" });
  };
  useEffect(() => {
    if (!initialMatch || !race.data || scrolledToLink.current) return;
    scrolledToLink.current = true;
    inspector.current?.scrollIntoView({ block: "start" });
  }, [initialMatch, race.data]);
  useEffect(() => {
    const key = `${pet?.id}:${active.data}`;
    if (active.data && active.data > 0n && followedActive.current !== key) {
      followedActive.current = key;
      // A shared link always takes priority over automatic selection.
      if (!initialMatch && lookup === null) focusMatch(active.data, false);
    }
  }, [active.data, pet?.id, lookup]);
  useEffect(() => {
    setOpponent("");
    setError("");
    setValidation("");
  }, [pet?.id, address]);

  const data = !race.isError && snapshot ? race.data : undefined;
  const seedSaved = Boolean(data && BigInt(data.seed) !== 0n);
  const hashAvailable = Boolean(
    data &&
      snapshot &&
      snapshot.block > data.randomBlock &&
      snapshot.block <= data.randomBlock + 256n,
  );
  const ready = Boolean(
    data?.state === 2 &&
      snapshot &&
      snapshot.timestamp >= data.readyAt &&
      (seedSaved || hashAvailable),
  );
  const expired = (r: Race) =>
    Boolean(
      snapshot &&
        ((r.state === 1 && snapshot.timestamp >= r.offeredAt + 3600n) ||
          (r.state === 2 &&
            BigInt(r.seed) === 0n &&
            snapshot.block > r.randomBlock + 256n)),
    );
  const offerEnded = (r: Race) =>
    Boolean(
      snapshot &&
        (snapshot.timestamp >= r.offeredAt + 3600n ||
          (core && core.week !== r.week)),
    );
  const ttl = (r: Race) => {
    if (!snapshot) return "1h offer TTL · refresh Sepolia for time remaining";
    const left = r.offeredAt + 3600n - snapshot.timestamp;
    return left <= 0n
      ? "1h offer TTL elapsed"
      : `1h offer TTL · ${fmt((left + 59n) / 60n)} min left at latest block`;
  };
  const canChallenge = Boolean(canWrite && pet && !pet.locked && core);
  const copy = async (id: bigint, automatic = false) => {
    try {
      await navigator.clipboard.writeText(`Match #${id}: ${matchLink(id)}`);
      setSharing(
        `Match #${id} and link copied${automatic ? " automatically" : ""}. Send it to the other owner.`,
      );
    } catch {
      setSharing(
        `Match #${id} is ready. Clipboard unavailable; select and copy the link below.`,
      );
    }
  };
  const challenge = async (second: bigint) => {
    setError("");
    setValidation("");
    if (!address) {
      connect();
      return;
    }
    if (!pet || !canChallenge || !snapshot) return;
    try {
      // Recheck a typed ID as well as listed rivals. Simulation enforces weekly
      // limits/cooldowns and catches a transfer/lock/band change after this read.
      if (second === pet.id)
        throw new Error("Choose a HAM owned by another wallet.");
      const [owner, stamina, locked] = await Promise.all([
        read<Address>("HamsterRunNFT", "ownerOf", [second]),
        read<bigint>("HamsterRunNFT", "stamina", [second]),
        read<boolean>("HamsterRunNFT", "matchLocked", [second]),
      ]);
      if (sameOwner(owner, address))
        throw new Error("Choose a HAM owned by another wallet.");
      if (locked)
        throw new Error("This rival is locked. Refresh the rival list.");
      if (staminaBand(stamina) !== staminaBand(pet.stamina))
        throw new Error("Choose a rival in the same Stamina band.");
      const receipt = await send("race", "MatchBook", "challenge", [
        pet.id,
        second,
      ]);
      if (!receipt) return;
      for (const log of receipt.logs) {
        if (!sameOwner(log.address, addresses.MatchBook)) continue;
        try {
          const event = decodeEventLog({
            abi: abi("MatchBook"),
            data: log.data,
            topics: log.topics,
          });
          if (event.eventName === "Challenged") {
            const id = (event.args as unknown as { matchId: bigint }).matchId;
            focusMatch(id);
            await copy(id, true);
            return;
          }
        } catch {
          /* A different MatchBook event. */
        }
      }
      setError(
        "Challenge confirmed, but its ID could not be decoded. Refresh your pending challenges.",
      );
    } catch (e) {
      setError(readableError(e));
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!address) {
      connect();
      return;
    }
    try {
      void challenge(integer(opponent, 1n, 10000n));
    } catch (e) {
      setError(readableError(e));
      document.getElementById("opponent")?.focus();
    }
  };
  const act = async (method: string, id: bigint) => {
    focusMatch(id);
    await send("race", "MatchBook", method, [id]);
  };
  const rows = rivals.isError
    ? []
    : (rivals.data?.pages.flatMap((p) => p.rivals) ?? []);
  const offers = inbox.isError
    ? []
    : (inbox.data?.pages.flatMap((p) => p.matches) ?? []);
  return (
    <section
      id="racing"
      className="panel race-panel"
      aria-labelledby="race-heading"
    >
      <div className="section-heading">
        <h2 id="race-heading">A friendly 1v1</h2>
        <span className="tag lilac">Sepolia</span>
      </div>
      <p className="muted">
        {wiringPending
          ? "Racing unavailable until game wiring is verified."
          : "Choose a rival, then let their owner accept."}
      </p>
      <div className="rival-discovery">
        <div className="section-heading">
          <h3>Same-band rivals</h3>
          <button
            className="icon-button"
            aria-label="Refresh rivals"
            disabled={!pet || rivals.isFetching || !snapshot}
            onClick={() => rivals.refetch()}
          >
            ↻
          </button>
        </div>
        {pet && (
          <p className="small muted">
            HAM #{pet.id.toString()} · Stamina {bandRange(pet.stamina)} · band{" "}
            {staminaBand(pet.stamina) + 1} of 5
          </p>
        )}
        {!address ? (
          <div className="empty-inline">
            <p>Connect to choose your HAM and find a rival.</p>
            <button className="button" onClick={connect}>
              Connect
            </button>
          </div>
        ) : !snapshot ? (
          <p className="empty-inline">
            Rivals unavailable. Refresh Sepolia above.
          </p>
        ) : !pet ? (
          <p className="empty-inline">Select an owned HAM from your lineup.</p>
        ) : rivals.isPending ? (
          <p className="empty-inline" role="status">
            Checking owners, Stamina and race locks…
          </p>
        ) : rivals.isError ? (
          <div className="empty-inline">
            <p>Rival reads failed. No availability is assumed.</p>
            <button className="text-button" onClick={() => rivals.refetch()}>
              Retry rivals
            </button>
          </div>
        ) : (
          <>
            {rows.length ? (
              <ul className="rival-list">
                {rows.map((r) => (
                  <li key={r.id.toString()}>
                    <img src="./hamster.svg" alt="" width="36" height="36" />
                    <div>
                      <strong>HAM #{r.id.toString()}</strong>
                      <p className="small muted">
                        Stamina {fmt(r.stamina)} · unlocked
                      </p>
                    </div>
                    <button
                      className="button button-small"
                      disabled={!canChallenge || rivals.isFetching}
                      aria-label={`Challenge HAM #${r.id}`}
                      onClick={() => void challenge(r.id)}
                    >
                      Challenge
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-inline">
                No unlocked rivals in the IDs checked. A rival needs a different
                owner and the same band.
              </p>
            )}
            <p className="small muted">
              Checked IDs 1–{fmt(rivals.data?.pages.at(-1)?.through)} of{" "}
              {fmt(snapshot.supply)}.
            </p>
            {rivals.hasNextPage && (
              <button
                className="text-button"
                disabled={rivals.isFetching}
                onClick={() => rivals.fetchNextPage()}
              >
                {rivals.isFetchingNextPage
                  ? "Checking more…"
                  : "Check more HAMs"}
              </button>
            )}
          </>
        )}
        {pet?.locked && (
          <p className="small error-text">
            Your HAM is locked. Resolve its active match before challenging
            again.
          </p>
        )}
        <p className="small muted">
          Five accepted races per HAM and wallet each week. 24-hour rematch
          cooldown. Availability is rechecked before sending.
        </p>
      </div>
      <details className="manual-challenge">
        <summary>Challenge by HAM ID</summary>
        <form onSubmit={submit}>
          <label htmlFor="opponent">Opponent HAM ID</label>
          <div className="inline-form">
            <input
              id="opponent"
              name="opponent"
              inputMode="numeric"
              placeholder="Their HAM number"
              value={opponent}
              onChange={(e) => {
                setOpponent(e.target.value);
                setError("");
              }}
              aria-describedby="race-error"
            />
            <button
              className="button"
              disabled={Boolean(address && !canChallenge)}
            >
              {address ? "Challenge" : "Connect"}
            </button>
          </div>
        </form>
      </details>
      <div className="match-inbox">
        <div className="section-heading">
          <h3>Pending challenges</h3>
          <button
            className="icon-button"
            aria-label="Refresh pending challenges"
            disabled={!address || !snapshot || inbox.isFetching}
            onClick={() => inbox.refetch()}
          >
            ↻
          </button>
        </div>
        <p className="small muted">
          Incoming offers to accept; outgoing offers to cancel.
        </p>
        {!address ? (
          <p className="empty-inline">
            Connect to see this wallet’s offered matches.
          </p>
        ) : !snapshot ? (
          <p className="empty-inline">
            Inbox unavailable. Refresh Sepolia above.
          </p>
        ) : inbox.isPending ? (
          <p className="empty-inline" role="status">
            Checking offered matches…
          </p>
        ) : inbox.isError ? (
          <div className="empty-inline">
            <p>Pending challenges could not be read.</p>
            <button className="text-button" onClick={() => inbox.refetch()}>
              Retry challenges
            </button>
          </div>
        ) : (
          <>
            {offers.length ? (
              <ul className="offer-list">
                {offers.map(({ id, race: r }) => (
                  <li key={id.toString()}>
                    <a
                      className="offer-link"
                      href={matchLink(id)}
                      onClick={(e) => {
                        if (
                          !e.ctrlKey &&
                          !e.metaKey &&
                          !e.shiftKey &&
                          e.button === 0
                        ) {
                          e.preventDefault();
                          focusMatch(id);
                        }
                      }}
                    >
                      Match #{id.toString()} ·{" "}
                      {sameOwner(address, r.secondOwner)
                        ? "Incoming"
                        : "Outgoing"}
                    </a>
                    <p className="small">
                      HAM #{r.first.toString()} vs #{r.second.toString()}
                    </p>
                    <p className="small muted">
                      {ttl(r)}
                      {core && core.week !== r.week ? " · week ended" : ""}
                    </p>
                    <div className="button-row">
                      {sameOwner(address, r.secondOwner) ? (
                        <button
                          className="button button-small"
                          disabled={!canWrite || !core || offerEnded(r)}
                          onClick={() => act("accept", id)}
                        >
                          Accept
                        </button>
                      ) : (
                        <button
                          className="button button-small"
                          disabled={!canWrite}
                          onClick={() => act("cancel", id)}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => focusMatch(id)}
                      >
                        View match
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-inline">
                No offered matches for this wallet in the IDs checked.
              </p>
            )}
            {inbox.hasNextPage && (
              <>
                <p className="small muted">
                  Earlier matches have not been checked.
                </p>
                <button
                  className="text-button"
                  disabled={inbox.isFetching}
                  onClick={() => inbox.fetchNextPage()}
                >
                  {inbox.isFetchingNextPage
                    ? "Checking earlier…"
                    : "Check earlier matches"}
                </button>
              </>
            )}
          </>
        )}
      </div>
      <p id="race-error" className="small error-text" role="status">
        {error}
      </p>
      <div ref={inspector} className="match-lookup">
        {active.data && active.data > 0n && active.data !== lookup ? (
          <button
            className="text-button"
            onClick={() => focusMatch(active.data!)}
          >
            View HAM #{pet?.id.toString()}’s active match #
            {active.data.toString()}
          </button>
        ) : null}
        <label htmlFor="match-id">Match ID or shared link</label>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              let value = matchId.trim();
              if (/^https?:\/\//.test(value))
                value = new URL(value).searchParams.get("match") ?? "";
              const id = matchNumber(value);
              focusMatch(id);
              setValidation("");
              if (id === lookup) void race.refetch();
            } catch (e) {
              setValidation(readableError(e));
              document.getElementById("match-id")?.focus();
            }
          }}
        >
          <input
            id="match-id"
            name="match-id"
            value={matchId}
            onChange={(e) => {
              setMatchId(e.target.value);
              setValidation("");
            }}
            placeholder="Match number or link"
            aria-invalid={Boolean(validation)}
            aria-describedby="match-error"
          />
          <button className="button" type="submit">
            Load race
          </button>
        </form>
        <p id="match-error" className="small error-text" role="status">
          {validation}
        </p>
      </div>
      {lookup !== null && (
        <>
          <div className="share-match">
            <label htmlFor="match-link">Share match #{lookup.toString()}</label>
            <input
              id="match-link"
              value={matchLink(lookup)}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button className="text-button" onClick={() => copy(lookup)}>
              Copy match ID & link
            </button>
            <p className="small" role="status">
              {sharing}
            </p>
          </div>
          {!snapshot ? (
            <p className="empty-inline">
              Race state unavailable. Refresh Sepolia to retry.
            </p>
          ) : race.isPending ? (
            <p className="empty-inline" role="status">
              Loading race…
            </p>
          ) : race.isError ? (
            <div className="empty-inline">
              <p>Race unavailable. No state is assumed.</p>
              <button className="button" onClick={() => race.refetch()}>
                Retry race
              </button>
            </div>
          ) : (
            data && (
              <div className="race-status">
                <h3>
                  Match #{lookup.toString()} ·{" "}
                  {
                    [
                      "Not found",
                      "Offered",
                      "Accepted",
                      "Settled",
                      "Cancelled",
                      "Expired",
                    ][data.state]
                  }
                </h3>
                {data.state > 0 && (
                  <>
                    <p className="small">
                      HAM #{data.first.toString()} vs #{data.second.toString()}{" "}
                      · week {data.week.toString()}
                    </p>
                    <RaceStepper race={data} />
                  </>
                )}
                {data.state === 0 && (
                  <p className="small muted">
                    This match does not exist. Check the ID or shared link.
                  </p>
                )}
                {data.state === 1 && (
                  <>
                    <p className="small muted">
                      {ttl(data)}. Offers also close at week end. Only the
                      challenger is locked until acceptance.
                    </p>
                    <div className="button-row">
                      {!address ? (
                        <button className="button" onClick={connect}>
                          Connect to accept
                        </button>
                      ) : (
                        <>
                          {sameOwner(address, data.secondOwner) && (
                            <button
                              className="button"
                              disabled={!canWrite || !core || offerEnded(data)}
                              onClick={() => act("accept", lookup)}
                            >
                              Accept challenge
                            </button>
                          )}
                          {sameOwner(address, data.firstOwner) && (
                            <button
                              className="button"
                              disabled={!canWrite}
                              onClick={() => act("cancel", lookup)}
                            >
                              Cancel challenge
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {address &&
                      !sameOwner(address, data.firstOwner) &&
                      !sameOwner(address, data.secondOwner) && (
                        <p className="small muted">
                          Connect the invited HAM’s owner to accept, or the
                          challenger to cancel.
                        </p>
                      )}
                    {offerEnded(data) && (
                      <p className="small error-text">
                        This offer can no longer be accepted. The challenger can
                        cancel; anyone can release it after its 1h TTL.
                      </p>
                    )}
                  </>
                )}
                {data.state === 2 && (
                  <>
                    <p className="small muted">
                      Accepted: both HAMs are locked. Hash target is acceptance
                      block +2: block {data.randomBlock.toString()}.
                    </p>
                    <p className="small muted">
                      {seedSaved
                        ? "Seed saved. It stays available for settlement."
                        : `Save after block ${data.randomBlock}, through ${data.randomBlock + 256n} inclusive. Latest block ${snapshot.block}.`}
                    </p>
                    <p className="small muted">
                      ≥15s after acceptance:{" "}
                      {snapshot.timestamp >= data.readyAt
                        ? "time minimum met"
                        : `${data.readyAt - snapshot.timestamp}s remaining at latest block`}
                      .{" "}
                      {seedSaved || hashAvailable
                        ? "Hash ready."
                        : expired(data)
                          ? "Unsaved hash expired."
                          : "Waiting for the +2 block hash."}
                    </p>
                    <div className="button-row">
                      <button
                        className="button"
                        disabled={!canWrite || seedSaved || !hashAvailable}
                        onClick={() => act("captureRandomness", lookup)}
                      >
                        {seedSaved ? "Seed saved" : "Save seed"}
                      </button>
                      <button
                        className="button"
                        disabled={!canWrite || !ready}
                        onClick={() => act("settle", lookup)}
                      >
                        Settle race
                      </button>
                    </div>
                    <p className="small muted">
                      Save seed before its 256-block window closes. Settle can
                      also save it while the hash is available.
                    </p>
                  </>
                )}
                {data.state === 3 && (
                  <p>
                    HAM #{data.winner.toString()} wins. Distances:{" "}
                    {fmt(data.firstDistance)} / {fmt(data.secondDistance)} game
                    units.
                  </p>
                )}
                {data.state === 4 && (
                  <p className="small muted">
                    Offer cancelled. The challenger’s HAM is unlocked.
                  </p>
                )}
                {data.state === 5 && (
                  <p className="small muted">
                    Expired with no result or points. HAMs are unlocked; an
                    accepted race still uses its weekly quota.
                  </p>
                )}
                {(data.state === 1 || data.state === 2) && (
                  <button
                    className="text-button"
                    disabled={!canWrite || !expired(data)}
                    onClick={() => act("expire", lookup)}
                  >
                    Release expired race
                  </button>
                )}
              </div>
            )
          )}
        </>
      )}
      {lookup === null && (
        <ol className="race-outline small">
          <li>Offer a challenge · 1h TTL</li>
          <li>The other owner accepts</li>
          <li>Save seed · acceptance block +2</li>
          <li>Settle · ≥15s and hash available</li>
        </ol>
      )}
      {notice}
    </section>
  );
}

function RaceStepper({ race }: { race: Race }) {
  const saved = BigInt(race.seed) !== 0n;
  const closed = race.state === 4 || race.state === 5;
  const stage = race.state === 3 ? 4 : race.readyAt > 0n ? (saved ? 3 : 2) : 1;
  return (
    <ol className="race-stepper" aria-label="Race progress">
      {["Offered", "Accepted", "Save seed", "Settle"].map((label, i) => (
        <li
          key={label}
          className={
            i < stage - 1 || stage === 4 || (closed && i < stage) ? "done" : ""
          }
          aria-current={
            !closed && i === stage - 1 && race.state !== 3 ? "step" : undefined
          }
        >
          <span aria-hidden="true">{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
