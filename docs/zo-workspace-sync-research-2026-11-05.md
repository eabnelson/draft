# Connecting Draft to Zo Knowledge

Research date: November 5, 2026.

## Recommendation

Replace credential pasting as the default connection flow with a Draft-owned
OAuth public client using authorization code and PKCE, a system-browser consent
page, and a loopback callback. Keep Draft's local document store and two-way
merge model. Continue calling the System API over HTTP for background sync.

This is a recommendation based on source and current first-party documentation,
not a live verification of a Draft OAuth client or a target workspace.

## What Draft does today

- [ZoSync.tsx](../src/ZoSync.tsx) asks an agent to create a service account,
  assign workspace Builder and folder Knowledge: all, then return a client secret
  in chat. It falls back to workspace Full access if the folder grant fails.
- [zo-sync.ts](../desktop/zo-sync.ts) exchanges that secret, stores it in Keychain,
  and extracts the workspace ID from a workspace-bound JWT claim. Requests do not
  send a workspace selector.
- The same module inventories remote packages with `zo.kb.search`, polling every
  30 seconds. It already uses revisions, idempotency keys, local recovery, and
  [draft-merge.ts](../desktop/draft-merge.ts) for two-way changes.

## Changes in Zo that matter

1. OAuth consent can issue credentials for an existing eligible service account
   or the approving person. One sign-in can cover several workspaces. Consent
   creates credentials, not grants. The application must be registered with Zo;
   automatic registration is unavailable. Native loopback callbacks may use a
   dynamic port. [Authentication](https://github.com/zocomputer/hostagent/blob/main/src/hostagent/system_api/docs/guides/authentication.md).
   Relevant merged changes include [service-account consent, October 20](https://github.com/zocomputer/hostagent/pull/10126)
   and [multi-workspace consent UI, October 23](https://github.com/zocomputer/hostagent/pull/10235).
2. `GET /zo-system-api/v1/session` returns currently authorized workspace IDs,
   names, and effective identities. Sign-in tokens require an explicit workspace
   selector on invocation; Draft's JWT-claim extraction cannot be reused for them.
   [Session contract](https://github.com/zocomputer/hostagent/blob/main/src/hostagent/system_api/docs/references/http/routes/get-zo-system-api-v1-session.md).
3. Knowledge stores workspace files without a running Zo computer. `zo.kb.list`
   supports updated-time sorting and filtering; `details: true` includes MD5 when
   recorded. Polling should overlap timestamps and deduplicate because commits
   can arrive out of order. Listing is per folder, so package subfolders need
   traversal. [Knowledge guide](https://github.com/zocomputer/hostagent/blob/main/src/hostagent/system_api/docs/guides/knowledge.md).
4. The CLI gained device-code login on November 4. That is useful for terminal
   and remote clients. Device authorization requires an enabled client, and the
   CLI guide still calls production browser sign-in unverified. It is an option
   to evaluate, not evidence that Draft can immediately reuse the CLI's identity.
   [CLI change](https://github.com/zocomputer/hostagent/pull/10693),
   [device contract](https://github.com/zocomputer/hostagent/blob/main/src/hostagent/system_api/docs/references/http/routes/post-zo-system-api-oauth-device_authorization.md),
   [CLI guide](https://github.com/zocomputer/hostagent/blob/main/src/hostagent/system_api/docs/guides/cli.md).

## Proposed connection and sync behavior

1. Click **Connect to Zo**, authorize in the browser, then choose an authorized
   workspace and Knowledge folder in Draft. Request only the workspace needed
   for this connection when the consent flow permits that selection.
2. Prefer a dedicated Draft service account with explicit file permissions for
   the chosen folder plus the workspace browsing permission its picker needs.
   An eligible account and its grants must already exist or be provisioned in
   an explicit setup flow. The current consent screen links owners to account
   creation; it does not automatically create a Draft account or folder grant.
   [Consent behavior](https://github.com/zocomputer/hostagent/blob/main/src/hostagent/system_api/docs/guides/mcp.md#sign-in-through-the-browser).
   Do not preserve the automatic Full access fallback. A folder Knowledge: all
   grant includes sharing administration; a custom narrower sync policy can be
   designed if that extra authority is unwanted.
3. Store the refresh token in Keychain, serialize refresh, atomically save its
   replacement, and reconnect at expiry (sign-ins last at most 30 days). Validate
   callback state and issuer. Send `Zo-Workspace-Id` for the selected workspace.
   [OAuth rules](https://github.com/zocomputer/hostagent/blob/main/src/hostagent/system_api/docs/guides/authentication.md#sign-in-with-oauth).
4. Inventory package folders through authoritative folder listings. Use
   incremental timestamps to reduce repeated reads, and periodic complete
   inventories/metadata checks to reconcile deletions and moves. Updated-time
   filtering alone does not provide deletion tombstones or a durable change feed.
   Keep revision-based reconciliation; hashes are an optimization. A write
   conflict should reread and reconcile concurrent text before retrying, rather
   than merely fetch a newer revision and overwrite it.
5. Preserve the `.draft` packages, Markdown versions, images, offline writing,
   and recovery behavior. A separate readable summary/export per draft could
   improve Knowledge browsing and retrieval, but would be derived content; it
   should have an explicit policy for which version represents the draft.

## Preconditions

Register Draft's client and callback with Zo; verify the target workspace's
System API provisioning, active storage allowance, folder grants, and a complete
browser login/refresh/file-update flow. Current main uses provisioning readiness,
not the obsolete rollout allowlist in the older local working-tree checkout.
[Availability](https://github.com/zocomputer/hostagent/blob/main/src/hostagent/system_api/docs/guides/availability.md),
[operations](https://github.com/zocomputer/hostagent/blob/main/docs/systems/zo-platform/operations.md).

No app code, credentials, workspace resources, or permissions changed during this
research. Current remote documentation was checked through GitHub; local
`origin/main` was used for recent history without switching or updating the
hostagent working tree.

## Implementation verification

Implemented in Draft on November 5 after this research. The public client
`draft-desktop` was registered using Zo's existing operator command, without
hostagent code changes. Browser approval as a service account, workspace and
folder selection, and the first sync to an existing `/workspace/Draft` folder
were verified in the installed Mac app. Settings reported a successful sync.
App tests, host tests, and the production desktop build passed.
