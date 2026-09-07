# Installed candidate receipt — September 7, 2026

## MEASURED / PROVEN — source and build

Root worktree `/Users/matheusbgodoi/src/local-studio-readiness` was clean at `eb6f875f9c2f81080c2848ff25a8ba2a8df3e267` before and after these successful commands:

- `npm run check`: exit 0; static analysis, frontend production build, controller checks and runtime production build completed.
- `npm --prefix frontend run desktop:dist:dev`: exit 0; native dependency preparation, embedded frontend/runtime assertions and macOS archive/blockmap generation completed.

Logs: `/tmp/local-studio-readiness-check-final2-20260907.log` and `/tmp/local-studio-readiness-build-final2-20260907.log`.

App: `frontend/dist-desktop-dev/mac-arm64/CRIAs AI Dev.app`.

| Artifact | SHA-256 |
| --- | --- |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64-mac.zip` | `5a29775cd54924d5465b37d23809525591fe78d50aa7e1b732177d3945e251a6` |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64.dmg` | `20c110d5d7e605858e77d0df73eafa678f2f13737413119886e63ea3d1456336` |

## DECIDED / APPLIED — installation scope

The root engineer installed the candidate through the documented installer and relaunched CRIAs AI Dev with isolated acceptance user data. The frontend served on loopback port 50801. Stable application data and production inference configuration were not changed by the browser diagnostic. This receipt covers the development installation, not promotion to the stable application.

## MEASURED / PROVEN — installed read-only acceptance

The existing authenticated `perf:browser` entrypoint observed each targeted route for nine seconds after load. Authentication was read from the isolated frontend token file into a loopback-scoped cookie; no credential or transcript was printed. No inference request was sent.

| Route | Document | FCP | Browser task time | JS heap | Uncaught / console errors | ARIA busy markers |
| --- | --- | --- | --- | --- | --- | --- |
| `/agent` | HTTP 200, app scripts | 64 ms | 166.2 ms | 13.7 MiB | 0 / 0 | 0 |
| `/models` | HTTP 200, app scripts | 80 ms | 125.3 ms | 8.0 MiB | 0 / 0 | 0 |
| `/runs` | HTTP 200, app scripts | 84 ms | 106.9 ms | 7.9 MiB | 0 / 0 | 0 |

No predefined `Offline` or `No models` label was present. The root's installed model API inspection returned five models, retaining Mac Ornith and four RTX aliases while excluding Chatterbox and S3Tokenizer. Optional remote capability routes and the event endpoint still returned HTTP 404. The profiler reports these transport failures and exits nonzero; they are not classified as document or JavaScript crashes.

Browser log: `/tmp/local-studio-installed-final2-browser-20260907.log`. Earlier bounded offline and recovery results, including the explicit unavailable labels, are in `status-readiness-2026-09-07.md`; the unchanged eleven-route sweep was not repeated for this targeted candidate.

## TARGET / NOT APPLIED — task evidence label acceptance

Read-only inspection of all eight existing acceptance run snapshots found 48 tasks and 139 acceptance criteria. Every existing criterion lacked `evidenceSource`; these are legacy records. The source renders distinct `Model reported · Not independently verified`, `Runtime observed`, and legacy labels. There was no actual new model-report criterion in this data to establish installed visual acceptance of that specific label. No task, criterion or model response was fabricated to satisfy this check. A subsequent real task must exercise that path before claiming it proven.

These page observations do not prove interactive task cancellation, same-tab reconnection, long-session stability, successful inference, or the new uncensored admission guard. Those require their separately coordinated acceptance steps.
