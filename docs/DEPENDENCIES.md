# Vendored dependencies

The compiler is pinned to Solidity 0.8.26 in `foundry.toml`. All library and browser dependencies are ordinary files; installation and network access are unnecessary for builds and tests.

| Dependency | Pinned release | Location | License |
| --- | --- | --- | --- |
| OpenZeppelin Contracts | v5.0.2 | `lib/openzeppelin-contracts/contracts/` (import closure used by this project) | MIT; adjacent `LICENSE` |
| forge-std | v1.9.7 | `lib/forge-std/src/` | Apache-2.0 / MIT; adjacent license files |
| ethers browser ES module | 6.13.5 | `demo/vendor/ethers-6.13.5.min.js` | MIT; adjacent `ethers-LICENSE.md` |

Sources: `https://codeload.github.com/OpenZeppelin/openzeppelin-contracts/tar.gz/refs/tags/v5.0.2`, `https://codeload.github.com/foundry-rs/forge-std/tar.gz/refs/tags/v1.9.7`, and `https://registry.npmjs.org/ethers/-/ethers-6.13.5.tgz`. No submodules or package-manager runtime directories are needed.

Browser bundle SHA-256: `08f3be0965c8cefc3225e840f84de0fb50aaa0564bd9867d78e3017207b432ae`.

The published upstream ABI is pinned as `docs/upstream/SqueekCore.v3.json`, retrieved from `https://docs.squeekchain.com/assets/abi/SqueekCore.json`. Its SHA-256 is `95d9ea6a90e68b7e3e124a111c9784d04fbe6a0d2b4e615757506d9fc6a04e91`. The five interface functions used by Solidity were compared field-for-field, including nested tuples, with this ABI. The published deployment record is preserved as `docs/upstream/sepolia.json`; this is the upstream graph, not a HamsterRun deployment receipt.
