# ITOMA Development Guidelines

## Product

ITOMA (いとま) helps users reclaim personal time by reducing impulsive smartphone app usage.

Read `docs/ITOMA_CODEX_HANDOVER.md` for the agreed direction and Factory roadmap. Treat proposed specifications and unconfirmed permissions as unverified until checked against code and actual results.

## Technology & Scope

- Target iOS only for now. Prioritize mobile-first patterns, performance, and native iOS behavior.
- Use React Native, Expo, and TypeScript for the application.
- Use Swift for native iOS functionality and the Expo Modules API for native bridging.
- Keep the application local-first, with no custom backend.

## Design

Read and follow `DESIGN.md` before UI, interaction, or copy changes. Explain the user's task, the information hierarchy, and the reason for visual choices in the PR. Preserve understandable state, cancellation, and honest mock/OS status. Do not optimize for engagement or introduce coercive friction; any deliberate friction must match the user's explicitly chosen rules. Record accessibility checks and unverified device behavior separately.

## Architecture

- Keep UI and presentation logic in TypeScript.
- Implement Screen Time API integration in Swift.
- Native extensions must operate independently of the JavaScript runtime.
- Use typed interfaces for native modules.
- Keep business logic independently testable.
- Keep custom native functionality in local Expo modules and use config plugins for native project configuration, consistent with Continuous Native Generation (CNG).

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

## Verification

Run these checks before declaring any task done:

```bash
npx tsc --noEmit
npm run lint
npm test -- --ci --runInBand
npx expo-doctor
```

For Bun projects, use `bun run lint` and substitute `bunx` for `npx`.

Report what was tested on Simulator and what was tested on a physical device separately. Do not claim physical-device behavior is verified without testing it on a device. Explicitly identify native behaviors that remain unverified.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Restrictions

- Do not add a backend without approval.
- Do not introduce actual payments yet.
- Never commit credentials or signing keys.
- Do not add custom authentication or Android functionality.
- Submit changes from a working branch through a PR. Do not merge into main, enable auto-merge, distribute builds, or publish without explicit authorization.
- Do not run `create-expo-app` or `expo prebuild --clean` over the existing project without a verified regeneration strategy that preserves custom native functionality.

## Pull Requests

Include:

- Summary of the changes
- Test results
- Screenshots for UI changes
- Known limitations
- Native behaviors not yet verified
- Tested commit SHA / JS bundle and, for native verification, build ID and native configuration match

Swift, native module, extension, entitlement, or config plugin changes require a build containing those changes. Label older build results as `stale native build`; do not count them as verification of the PR. Identify the JS bundle version or commit for UI verification too.

Keep Simulator/UI evidence separate from physical-device Screen Time validation. Report failures and skipped checks honestly. Cloud QA access and signing approval must not be inferred from a connected Codex Cloud repository.
