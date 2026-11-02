# Submission byte and path budget

Conservative full size of every added/modified file, including required production bundles, source, documents, reports and six screenshots. Deletions and unchanged baseline files are excluded. No Git staging/commit operation was performed by the worker; these are the prepared files for the network submission.

| Path group | Measured added/modified bytes |
| --- | ---: |
| `web/` | 190,620 |
| `dist/` | 820,488 |
| `artifacts/` | 339,373 |
| `root documentation` | 37,332 |

**Total: 1,387,813 bytes (1.324 MiB), across 34 files.** Limit: **8,388,608 bytes**; headroom: **7,000,795 bytes**.

The complete runtime source/assets/export and existing tracked frontend manifest/lockfile are retained. The final export exactly matches the last successful production build; runtime network bytes and addresses/ABI hashes match the pinned inputs.

Existing ignore files are unchanged. Their existing budgets remain satisfied: six screenshots total 310,236 bytes (under 512 KiB); four retained reports total 29,137 bytes (under 72 KiB). Generated dependencies, caches, service data and scratch evidence contribute zero submitted bytes.

No new dependency archive, symlink or submodule is present. Protected contracts/tests/build configuration/manifests/lockfiles/dependencies and `.gitignore` files are unchanged. Nothing under `.git/`, `.github/`, `.env` or `node_modules/` was edited.
