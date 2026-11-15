# 17: Publish the Preset to npm

Status: ready-for-human
Blocked by: None

Spec: `.scratch/sandcastle-pro/spec.md` (user story 1, and "distributed on npm as `sandcastle-pro`")

**What to build:** Make `sandcastle-pro` installable in any project in two commands:

```sh
npm install -D sandcastle-pro
npx sandcastle-pro init
```

The name is free on the public npm registry. Publish it unscoped, starting at `0.1.0`. A GitHub Action publishes each release when a `v*` tag is pushed, so a release always passes the same `npm run check` as CI.

It is `ready-for-human` because the npm account, `npm login`, and the `NPM_TOKEN` repository secret are steps only you can do. Once those exist, the code part could go back to `ready-for-agent`.

- [ ] `package.json` is ready to publish: `version` is `0.1.0`, and it has `repository`, `homepage`, `bugs`, `keywords` and `author`. A `prepublishOnly` script runs `npm run check`, so `dist` is always built and checked before a publish.
- [ ] `npm pack` produces a tarball containing `dist`, `README.md`, `LICENSE` and `package.json`, and no source, tests or `.scratch`.
- [ ] Installing that tarball into an empty scratch project with `npm install -D <tarball>` works, and `npx sandcastle-pro init` and `npx sandcastle-pro --help` run there. This means `dist/cli.js` has a `#!/usr/bin/env node` shebang and is executable once installed.
- [ ] `README.md` at the repo root covers what the Preset is (one paragraph), the two-line quick start above, the config keys, and the Issue format, linking to `docs/agents/sandcastle-pro-issues.md`. It keeps a placeholder section for stacking (see `.scratch/stacked-issues/spec.md`).
- [ ] A `LICENSE` file (MIT) matches `"license": "MIT"`.
- [ ] `.github/workflows/release.yml` runs on a pushed `v*` tag: `npm ci`, `npm run check`, then `npm publish --provenance --access public` with `NODE_AUTH_TOKEN` from the `NPM_TOKEN` secret. It fails if the tag doesn't match `package.json`'s version.
- [ ] `docs/agents/` gets a short release note: bump the version, commit, tag `vX.Y.Z`, then push the tag.
- [ ] Human, once: create or log in to the npm account, add the `NPM_TOKEN` (automation token) repository secret, then push `v0.1.0` and confirm `npm view sandcastle-pro version` prints `0.1.0`.

## Comments
