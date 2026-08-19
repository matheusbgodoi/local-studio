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

npm --prefix frontend run desktop:dist
# install the freshly built artefact over /Applications/Local Studio.app
```

Keep a rollback copy of the previous `.app` before replacing it.

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
- Automations still respond

User data lives in `~/Library/Application Support/Local Studio` and is not touched
by a rebuild: `api-settings.json`, `connectors.json`, sessions, `pi-agent/`,
automations, last-used model and thinking preferences.

Usage's currency, electricity rate and calendar timezone live in the renderer's
`localStorage` under `local-studio.usage.energy`, mirrored to
`userData/ui-preferences.json` like every other durable preference, and survive a
rebuild the same way.
