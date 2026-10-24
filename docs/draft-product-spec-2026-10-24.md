# Draft — product baseline

Date: October 24, 2026
Status: Accepted baseline v0.2; macOS first, MIT license, and update-based activation confirmed October 24, 2026.
Working product name: Draft.

## Purpose

Draft is a fast local desktop writing app whose users own both their writing and their version of the app. The official app implements the writing experience in the initial product spec. A built-in Features page lets a person understand that experience, ask their existing coding agent to change it, and keep or remove those changes without managing a development environment themselves.

This is a new baseline derived from the owner's October 24 requirements. Preserve the [initial October 22 spec](initial-product-spec.md) unchanged as the record of the first Writing Room build. The current web versions are implementation references; web hosting, Zo sign-in, and cloud document storage are not requirements for this desktop baseline.

## Source, inspiration, and distribution

- Maintain one canonical public source repository containing the application, desktop packaging, build/release instructions, automated checks, feature catalog, dated product specifications, and original reference material.
- Credit [Jason Fried's original demonstration](https://x.com/jasonfried/status/2105403067793584590) as inspiration. Preserve the existing transcript and its extraction provenance.
- Keep the original spec and later specifications as separately dated documents. A later baseline must not silently overwrite the original.
- Use the MIT license for our application and authored documents. Keep the third-party transcript attribution separate; do not label the speaker's words as our authored work or automatically relicense them under the application's license.
- A normal download installs a desktop app. Opening, writing, and using already-configured AI must not require a terminal, GitHub account, manual dependency installation, or a developer build.
- The download must provide the matching editable source and the runtime/build support needed for supported in-app customization. The user can reveal, export, back up, or edit that source outside Draft.
- Define signing, notarization, release packaging, supported operating systems, and the recoverable customization build path before calling distribution ready. The current browser prototype is not that deliverable.

## Core writing product

The editor remains the core product, with a quiet Studio Four-style interface. Writing and ordinary editing must not wait for an AI process, network request, feature builder, or update check.

Implement the initial spec's capabilities:

1. Writing and clean reading, with word count and revision mode.
2. Alternate wording for words, sentences, and paragraphs, preserving the original and identifying human/AI origin.
3. Reversible hiding and reviving of passages.
4. Overflow for notes and spare writing.
5. Local saving, recovery, undo/redo, and portable native/text/Markdown import and export.
6. Optional AI alternatives, omission-only trim previews, and clarity/tone review.
7. English article assistance where supported, with conservative handling of uncertain pronunciation.

Use these as high-level catalog groups; individual acceptance criteria remain in the spec and tests. Agree measurable startup, typing, save, idle-memory, and customization-build budgets on representative hardware before claiming performance targets are met.

## Existing Claude Code and Codex connections

- Detect installed Claude Code and Codex tools and determine whether each is authenticated and usable. An executable's presence alone is insufficient.
- Reuse the provider's supported local configuration and authentication flow. Do not extract tokens into Draft's renderer or invent a separate credential-sync mechanism.
- Detect standard GUI-launch environments as well as terminal installations. Offer a clear install/sign-in action when no working provider is available.
- Offer a model selector populated from available provider capabilities. Remember an explicit user choice.
- When both providers are ready, prefer **Claude Opus 5.5** as requested. Verify that the connected account can use it. A missing model or entitlement must produce an explicit, understandable fallback choice rather than an invisible substitution.
- With only one usable provider, choose a compatible default from it so the first request does not require opening settings. Exact fallback policy remains to be finalized.
- Keep ordinary writing fully usable without a provider. Cancellations, lost authentication, rate limits, and provider failures preserve the draft and last working application.
- AI uses the person's existing online provider/account and its usage limits. Reusing a locally installed agent is not a promise of offline inference.
- Writing assistance and app customization use separate tool permissions. A writing suggestion does not need code execution. A feature-building agent works on source and test fixtures, with access to real documents excluded by enforced permissions.

Reference approach: [T3 Code](https://github.com/pingdotgg/t3code), particularly its [Claude setup](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md), [Codex setup](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-codex.md), and [execution architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md). Its remote/mobile product is not required for Draft.

Provider grounding checked October 24, 2026: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [programmatic Claude Code](https://code.claude.com/docs/en/headless), [Claude plan usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), and [Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5). Recheck relevant authentication and distribution contracts when implementing and releasing.

## Features page

Provide one consumer-facing page with a feature request field and two adjacent columns on desktop:

| Official Draft | Your changes |
| --- | --- |
| High-level capabilities in the selected official release. | Features added, changed, or removed in this personal version. |
| Last feature update date. | Creation date/time and last update date/time. |
| Whether an official update is available. | Clear current state and a restore/remove action. |

On narrow windows the same comparison may stack without losing the association between an official feature and its local modification. Keep descriptions short and group small edits under their parent feature instead of making every code change a row.

Use stable feature identities, official release associations, and a machine-readable catalog behind the simple view. Record enough implementation and verification information for the agent to inspect actual behavior. A catalog entry is not proof that a feature works. Display local dates/times while retaining unambiguous timestamps internally. Do not advance every feature's update date merely because the app was rebuilt.

The catalog distinguishes added features, changed official features, removed/disabled official features, pending changes, and failed builds. Pending or failed work must not appear as an installed capability.

## Requesting a feature

1. The person describes a desired change on the Features page.
2. Inspect the official and personal catalogs and the relevant implementation for an existing or similar capability. If found, show where to use it or offer to extend it. An ambiguous match should not permanently block the request.
3. If the request is new, generate it using the selected local coding-agent connection in an isolated candidate workspace. Preserve the running app and its source checkpoint.
4. Run appropriate behavior checks and a desktop build. Report progress and actionable failure information in ordinary language. Do not make the user interpret diffs or build logs to complete the normal flow.
5. Package the verified candidate as a complete personal app update. Show **Restart to update** only when it is ready. Clicking it durably saves open documents and applies the new version. A preview may be offered, but the primary activation model is an app update rather than Keep change.
6. After the updated version starts successfully, record the feature's short description, origin, timestamps, dependencies, and recovery information. Show it under Your changes.

The same flow can modify or remove official behavior, including layout and core writing behavior. This is ownership of an editable application, not merely a closed list of plugins. The packaging design must explicitly identify which edits can be rebuilt inside the installed app and how native-host changes are handled; do not claim arbitrary native changes are supported until that workflow works.

Personal changes remain local unless the person explicitly chooses to export or share them. A GitHub account is not required to own a personal version. Contribution and sharing workflows are later scope unless requested.

## Official updates and personal changes

Provide clear actions for **Update Draft**, **Remove change**, and **Return to official Draft**.

- Update Draft obtains a verified official release, lists its high-level changes, and prepares a candidate that retains the user's accepted personal changes.
- If an official update now includes an equivalent personal feature, identify the overlap and offer to adopt the official implementation while preserving relevant user settings/data.
- Reconcile overlapping edits using the agent where appropriate. Do not promise that arbitrary independent changes always merge automatically.
- If a conflict cannot be resolved and checked, keep the current working app available. Explain which features conflict and offer understandable choices: keep my behavior, use official behavior, or try combining them.
- Removing one personal feature must account for later changes that depend on it. Explain those dependencies before removing another capability as a consequence. Removing a feature is not assumed to be the same as reverting one code commit.
- Returning to official Draft restores a known official application version and removes active personal customizations. Preserve an exportable recovery copy of the personal version and leave documents intact.
- Background checks may announce available updates. Building customizations or resolving updates with the model should be user-triggered; do not silently spend provider usage while idle.

The source, accepted personal changes, in-progress candidate, recovery checkpoints, and the running version need explicit identities. A stable recovery mechanism must remain usable when a generated application fails to open. Users need not see source-control terminology in the normal interface.

## Local documents and data compatibility

- Store documents in a durable local document area outside application installation files, generated source, build output, and temporary feature workspaces.
- Provide a visible document location and portable backups/exports. Browser localStorage alone is not the desktop document store.
- App updates, feature removal, reinstall, and Return to official Draft must not delete that document area.
- Preserve a stable text-and-annotations format and version it explicitly. Retain unknown feature metadata when practical so removing code does not silently erase associated writing data.
- Separate local documents from the feature builder's code workspace. Enforce this separation, rather than relying only on instructions to the model.
- Data changes need recovery snapshots and compatibility checks. Keeping documents outside app code does not, by itself, guarantee that an older app understands a newer format.
- If an older official app cannot read a new format safely, offer recovery or conversion from a retained backup. Do not silently discard unsupported annotations to complete a rollback.

## Required release evidence

A first usable desktop release needs evidence that a person can download/open Draft, write and reopen a local document, reuse an existing agent login, request a new feature, keep a working result, and see it dated in the comparison.

Also exercise duplicate requests, canceled/failed builds, provider authentication failure, removing a dependent feature, combining an official update with local changes, returning to official Draft, and reopening documents afterward. Test source ownership and recovery with the original development checkout unavailable. A developer-only demo is insufficient.

## Confirmed product decisions

1. **Platform:** macOS first.
2. **License:** MIT for application code and authored specifications, with third-party reference attribution retained separately.
3. **Activation:** every change is delivered as an app update. This applies to adding a feature, removing one, updating official Draft while preserving custom changes, and returning to source Draft.
4. **Update states:** Checking request → Preparing update → Building and checking → Update ready → Applying update → Updated. Show honest stages rather than a fabricated download percentage. An AI-built change is described as being prepared locally; an official release can actually be downloaded.
5. **Agent completion:** a request includes end-to-end implementation, relevant tests, source/catalog changes, and building the candidate. An agent's claim that it finished is insufficient; the application runs its own checks before offering Restart to update.
6. **Apply:** apply is a deliberate user action. Keep the current version usable while preparing an update. Save documents before switching, preserve a recovery version, and roll back if the new UI does not confirm successful startup.
7. **One model:** use the selected Claude Code/Codex connection for both writing assistance and building features, with separate tool permissions. Prefer Claude Opus 5.5 when both are usable, remembering an explicit user choice.

Implementation choices should preserve these product decisions. Signing/notarization and supported native-host customization must be reported from actual release evidence, rather than inferred from a successful web build.

## Feature refinement — October 24 follow-up

Update progress uses everyday language. Compiler output, filenames, and technical verification details belong in the agent's context, outside the consumer update screen.

A ready, applied, cancelled, or unsuccessful feature can offer **Keep working on this**. **Copy prompt** provides the original request, current result, relevant diagnostics, existing features, and a separate working copy for the person's local agent. The agent asks what the person wants changed before editing. The prompt includes the local build commands and leaves real documents, credentials, and installed versions alone.

The person returns to **Check my changes**. Draft independently copies, checks, and prepares that work as a new update; **Restart to update** remains the explicit activation step. A failed check preserves the current app, earlier prepared update, and editable work. If the app changes meanwhile, a fresh prompt includes the preserved earlier working copy as a reference.

Draft's mark is an empty light grey highlight with a grey squiggle underneath on white. It uses the editor's existing highlight and underline colors; no letters appear inside the highlight.


## Feature list and restart update — October 24, 2026

Requests accumulate in a persistent list. A person can select, reorder, or remove ideas without starting the agent. Removing an installed feature adds its removal to the same list. **Download update** snapshots all selected requests and sends one prompt to the selected coding agent, completing and checking them together. New ideas can be added for a later update.

The download button becomes an approximate time remaining, based on recent preparation history when available. Clearly indicate when the estimate is exceeded; never present a fictional percentage or promise an exact completion time. A failed or cancelled preparation keeps the list and current app intact.

Once every requested change passes independent checks, show **Restart to update**. Save writing, temporarily prevent further edits, and restart the native app into the prepared version. Remove only the included ideas after successful startup confirmation. If startup fails, restore the previous app and retain the list. Returning to official Draft and checking external-agent work use the same restart interaction.

The repo includes a minimal landing page with the real editor and Features components running in an isolated browser demo. A looping tour demonstrates writing, alternatives, set aside, overflow, queued requests, a simulated download, and the resulting working demo features. Viewers watch the walkthrough, with pause/play and replay controls and support for reduced motion. Omit demo-only labels and instructions from the page and app preview. No local agent, account, personal document, or app API is accessed by the demo.
