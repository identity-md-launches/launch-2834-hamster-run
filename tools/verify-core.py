#!/usr/bin/env python3
"""Read-only Sepolia preflight. Pin all observations to one block; never sign or read a key."""
import argparse
import datetime
import json
import subprocess
import urllib.request
from pathlib import Path

CORE = "0x74665dAecA35A2303e767E76a2FF1FB6F93e119f"
IMPLEMENTATION = "0x0a71C86ab63a77675002A389FDF4D096A07b11e2"
RUNTIME_HASH = "0xe8a5a5aa913141ddd8951cf9fcc1375044b541773e5b0bf8ee04a5c7ac2d194d"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rpc", default="https://ethereum-sepolia-rpc.publicnode.com")
    parser.add_argument("--block", default="latest", help="Block number in decimal or hex, or latest")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    def rpc(method, params):
        request = urllib.request.Request(args.rpc, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"Content-Type": "application/json", "User-Agent": "HamsterRun-read-only-preflight/1"})
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
        if "error" in result:
            raise RuntimeError(f"{method}: {result['error']}")
        return result["result"]

    def cast(*arguments):
        return subprocess.check_output(["cast", *arguments], text=True).strip()

    chain = int(rpc("eth_chainId", []), 16)
    if chain != 11155111:
        raise RuntimeError("Not Sepolia")
    tag = args.block if args.block == "latest" or args.block.startswith("0x") else hex(int(args.block))
    block = rpc("eth_getBlockByNumber", [tag, False])
    tag = block["number"]

    def call(signature, *arguments):
        data = cast("sig", signature) + "".join(f"{argument:064x}" for argument in arguments)
        raw = rpc("eth_call", [{"to": CORE, "data": data}, tag])
        if raw == "0x":
            raise RuntimeError(f"Empty response for {signature}")
        return raw

    def words(raw):
        data = bytes.fromhex(raw[2:])
        if len(data) % 32:
            raise RuntimeError("Malformed ABI response")
        return [int.from_bytes(data[i:i + 32], "big") for i in range(0, len(data), 32)]

    version = words(call("implementationCodeVersion()"))[0]
    implementation = "0x" + f"{words(call('implementationCodeAddress()'))[0]:040x}"
    runtime = rpc("eth_getCode", [implementation, tag])
    proxy_code = rpc("eth_getCode", [CORE, tag])
    runtime_hash = cast("keccak", runtime)
    if version != 3 or implementation.lower() != IMPLEMENTATION.lower() or runtime_hash != RUNTIME_HASH or proxy_code == "0x":
        raise RuntimeError("Core identity differs from the pinned deployment; review required")
    state = words(call("state()"))
    config = words(call("configuration()"))
    if len(state) != 8 or len(config) != 11 or config[2] != 600 or config[1] == 0:
        raise RuntimeError("Unexpected V3 ABI or configuration")
    timestamp = int(block["timestamp"], 16)
    current = (timestamp - config[1]) // 600 + 1
    if timestamp < config[1] or state[0] >= current:
        raise RuntimeError("Invalid frontier / timestamp relationship")
    end = state[0]
    start = max(0, end - 6)

    def endpoint(round_id):
        data = words(call("roundPage(uint64,uint64,uint256)", round_id, round_id, 0))
        if len(data) < 10 or data[0] != 32 or data[1] != round_id or data[2] != data[5] or data[8] != 256 or data[9] != 0:
            raise RuntimeError("Endpoint response does not match pinned V3 ABI")
        return data[5]

    before, after = endpoint(start), endpoint(end)
    if after < before:
        raise RuntimeError("Cumulative work decreased")
    snapshot = {
        "chainId": chain,
        "blockNumber": int(tag, 16),
        "blockHash": block["hash"],
        "blockTimestamp": timestamp,
        "blockTimeUTC": datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).isoformat(),
        "core": CORE,
        "proxyRuntimeHash": cast("keccak", proxy_code),
        "implementation": implementation,
        "implementationVersion": version,
        "implementationRuntimeHash": runtime_hash,
        "genesisTimestamp": config[1],
        "roundDuration": config[2],
        "maxWorkPerRound": config[3],
        "currentRound": current,
        "settledThroughRound": end,
        "closedUnknownRounds": current - 1 - end,
        "paused": bool(state[7]),
        "cumulativeWork": state[1],
        "historicalEndpointRead": {"afterRound": start, "throughRound": end, "startCumulativeWork": before, "endCumulativeWork": after, "physicalWorkDelta": after - before},
        "note": "Historical read-only observation, not a HamsterRun training award or a game deployment. New bookings must select future rounds."
    }
    output = json.dumps(snapshot, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    print(output, end="")


if __name__ == "__main__":
    main()
