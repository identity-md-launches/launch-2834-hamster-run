# Submission byte and path budget

The conservative audit counts the complete size of every new or modified file, including the full modified README and both ignore files. Unchanged baseline files and disposable scratch checks are excluded. Git packing overhead is not estimated; the margin below is intentionally large.

| Path group | Explicit budget | Measured bytes |
| --- | ---: | ---: |
| `web/` | 2,097,152 | 443,157 |
| `dist/` | 2,097,152 | 930,762 |
| `artifacts/` | 1,048,576 | 334,553 |
| `root docs and ignore` | 262,144 | 34,287 |

**Total: 1,742,759 bytes (1.662 MiB), across 73 files.** Assignment limit: **8,388,608 bytes**. Remaining headroom: **6,645,849 bytes**.

The required source, frontend manifest and lockfile, complete runtime assets, static export, design documentation and validation evidence remain present. No runtime asset was removed to reduce the payload.

`web/.gitignore` is budgeted below 1 KiB and excludes generated `node_modules/`, `.vite/`, `.cache/`, `coverage/`, `service/data/` and `*.tsbuildinfo` at its scope: zero submitted bytes. The root `.gitignore` is budgeted below 2 KiB and only adds explicit exceptions for four reports (72 KiB combined budget) and six PNG screenshots (512 KiB combined budget). Those exceptions retain the requested evidence despite a broader inherited artifact exclusion. Existing ignore entries are preserved.

The final candidate list contains no generated dependency/cache directories, package archives, database files, symbolic links or new submodules. The temporary dependency link used for local checks was removed. No file under `.git/`, `.github/`, `.env`, root `node_modules/`, `lib/`, or the existing build/dependency configuration was changed. No commit/staging operation was performed; these are the files prepared for the assignment’s Git submission bundle.
