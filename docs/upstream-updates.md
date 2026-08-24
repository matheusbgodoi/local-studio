# Upgrading this fork from upstream

This installation is **not** stock Local Studio. It is built from
`matheusbgodoi/local-studio` and carries changes that do not exist in
`sybil-solutions/local-studio`:

- the controller identity points at the RTX 3090 over the tailnet, and Chat, the
  model catalogue, **Status and Usage** all share it
- Status and Usage read live host telemetry (see below)
- personal MCP connectors, armed per session rather than per install
- Pi packaging and the extension set

An upstream release artefact contains none of that. Installing one replaces the
app with stock and the customisation is gone.

## What the app does about it

`frontend/desktop/logic/update-manager.ts` keeps **checking** for upstream
releases and keeps **reporting** them, because knowing a newer version exists is
useful. What it will not do is act on that by itself:

```ts
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.autoRunAppAfterInstall = false;
```

and `installDownloadedUpdate()` refuses, with a message pointing here.

`LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE=true` still disables checking entirely
if even the notification is unwanted.

**Never** install the upstream DMG over `/Applications/Local Studio.app`.

## Where this fork sits today

|                |                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Fork base      | upstream **2.1.0** (merge-base `eeeb3406`)                                                                  |
| Fork build     | **`v2.1.0-local.14`** — [release](https://github.com/matheusbgodoi/local-studio/releases/tag/v2.1.0-local.14) |
| Upstream today | **v2.15.2**                                                                                                  |

The fork is deliberately behind. Upstream has released fourteen minor versions on top
of the base this fork was cut from, and none of them has been merged, because a
sync is a decision with a cost — every one of the five divergences in
[`NOTICE`](../NOTICE) has to be re-reconciled by hand afterwards. Being behind is
a choice; not knowing by how much would be the problem.

Check the real numbers before planning a sync:

```bash
git fetch origin fork
git rev-list --left-right --count origin/main...main   # upstream-only <TAB> ours-only
git log --oneline origin/main ^main                    # what we would be taking
```

## Versioning an owner build

Upstream owns `x.y.z`, so the fork must never claim one. An owner build is a
SemVer **pre-release** naming the base it derives from:

```
<upstream base>-local.<n>        e.g. v2.1.0-local.1
```

`2.1.0-local.1` sorts _below_ upstream `2.1.0`, which is the correct signal: it is
a derivative of that base, not a successor to it. `n` increments for each owner
build cut from the same base; adopting a newer upstream base restarts it at `.1`.

Tag owner `main` only, never a feature branch. The full policy — including why no
binary is attached to a fork release — lives in the parent project's
[`RELEASING.md`](https://github.com/matheusbgodoi/local-ai-3090-stack/blob/main/RELEASING.md).

## The upgrade path

```bash
cd ~/src/local-studio
git fetch origin            # origin = sybil-solutions (upstream)
git fetch fork              # fork   = matheusbgodoi  (ours, canonical)

git checkout main           # tracks fork/main
git checkout -b chore/sync-upstream-<version>
git merge origin/main       # merge, never rebase - owner history is not rewritten
# resolve conflicts in favour of keeping the fork's behaviour

npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm run check                     # full pipeline
npm --prefix frontend run build

# merge to owner main through the fork's normal workflow, then:
git push fork main                # no --force, ever

npm --prefix frontend run desktop:dist -- --config.mac.identity=null
# install the freshly built artefact over /Applications/Local Studio.app

git tag -a v<new base>-local.1 -m "..."   # on owner main, after it is final
git push fork v<new base>-local.1
```

Keep a rollback copy of the previous `.app` before replacing it.

The build is **ad-hoc signed** — this fork has no Developer ID certificate and no
notarisation. Gatekeeper will warn on first launch. That is expected for a build
you made yourself, and it is why a fork release ships source rather than a DMG
that would look official and is not.

## What must survive an upgrade

Verify after every rebuild:

- the model picker lists exactly `qwen-daily`, `qwen-turbo`, `gemma-write`
- `qwen-daily` reports context **149504**, vision on, reasoning on, and the four
  thinking levels Off / Low / Medium / XHigh
- last-used model is restored on launch, and Thinking is remembered per model
- Skills stay lazy; MCP connectors stay session-scoped and start empty
- Status shows the real resident model and live RTX 3090 metrics
- Usage opens on Tokens/Today/All models, leads with **Processed tokens**, and
  increments after one request
- Usage Energy shows kWh with a coverage figure, and cost stays "Set rate" until
  a tariff is entered
- Usage Efficiency shows processed tokens per kWh, or says which half is missing
- the Browser toggle still gates everything: with it OFF no `browser_*` tool
  (including `browser_search`) reaches the model; with it ON search returns
  results and a page opens and reads
- Automations still respond

User data lives in `~/Library/Application Support/Local Studio` and is not touched
by a rebuild: `api-settings.json`, `connectors.json`, sessions, `pi-agent/`,
automations, last-used model and thinking preferences.

The browser profile — where verification and login cookies live — is
`<userData>/browser-profile` and is not touched by a rebuild. See
[`web-search.md`](web-search.md).

Usage's currency, electricity rate and calendar timezone live in the renderer's
`localStorage` under `local-studio.usage.energy`, mirrored to
`userData/ui-preferences.json` like every other durable preference, and survive a
rebuild the same way.
