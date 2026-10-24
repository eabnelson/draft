Draft v0.1 · October 22, 2026

Build a focused writing editor that lets people compare wording in context, set text aside, and explore cuts while retaining control of the draft. The core experience must work without AI.

This is a specification for the writing editor demonstrated by Jason Fried, separate from the toscript transcription tool. The source is the narrated demonstration in [Jason Fried’s video](https://x.com/jasonfried/status/2105403067793584590). Demonstrated behavior is mapped below; the requirements, architecture, priorities, and release gates are proposed decisions for our implementation.

# Product objective

Help an individual writer reach a preferred draft without scattering alternatives across duplicate documents, deleting uncertain passages too early, or letting AI replace their voice.

The primary user writes essays, product copy, newsletters, announcements, and other prose in which small wording decisions matter.

The central workflow is: write a draft, attach alternate wording to a passage, compare options inside the surrounding prose, temporarily set aside uncertain text, and export the version the writer chooses.

# Evidence from the demonstration

| Time | Demonstrated or described behavior |
| --- | --- |
| 00:00–00:31 | A plain editor reveals revision features through its word-count control. |
| 00:31–02:21 | Alternate wording applies to headlines, individual words, and paragraphs. A side panel holds options; the draft shows the selected one and indicates when it differs from the original. English articles adjust during an example substitution. |
| 02:21–02:53 | A passage can be faded while remaining recoverable, then restored. |
| 02:53–03:39 | AI can suggest additional alternatives. The interface distinguishes human and AI suggestions. |
| 03:39–04:31 | A separate overflow panel stores spare writing and accepts text moved out of the main draft. |
| 04:31–04:47 | Save, open, and X posting are mentioned. The LinkedIn interaction is presented as a joke, not a requirement for our editor. |
| 04:47–05:18 | An editing panel includes checks for complicated sentences and words that conflict with the document’s tone. |
| 05:18–05:59 | Several strengths of trimming mark candidate omissions without rewriting the remaining text. |
| 06:40–06:49 | The creator expresses an intention to make the tool freely available and open source. Our distribution and licensing remain separate decisions. |

# Proposed scope and priorities

| Priority | Scope |
| --- | --- |
| P0 | Plain writing, revision mode, human-authored alternatives, reversible hiding, overflow, undo, durable local saving, portable import/export, and keyboard access. |
| P1 | Optional AI alternatives, AI cut previews, sentence and tone checks, and assisted English article changes. |
| Later | External posting integrations, mobile editing polish, richer document formatting, and synchronization. |

P0 is the first usable release. P1 completes the demonstrated editing concept and can ship separately.

V1 excludes real-time collaboration, accounts, comments, tracked reviewer approvals, an all-purpose word processor, and autonomous publication. Neither a specific AI provider nor a client framework is selected by this spec.

# Editing experience

The main canvas is a quiet single-column editor. A word count remains visible. Activating it reveals revision annotations and editing controls; turning revision mode off hides those controls without discarding their data or changing the selected wording.

Plain mode shows the active wording and omits hidden passages. Revision mode reveals those passages in place so they can be reviewed or restored.

Use one right-hand panel with clearly labeled views for Alternatives, Overflow, and Editing. Preserve the selected view and its contents when the panel closes.

Word count refers to the active main draft. Exclude overflow and manually hidden passages. During an AI cut preview, show a separate projected count and reduction so the current draft is not confused with the proposed result.

Ordinary typing, selection, arrow keys, copy/paste, and undo must retain their expected editing behavior. Hover may reveal a variant control, but arrow keys cycle alternatives only when that control has keyboard focus. They must not hijack caret movement while the writer is editing text.

# Functional requirements

## F1 Compare alternate wording

A writer can select a word, sentence, headline, or paragraph and attach alternatives to it. The original wording remains recoverable. New alternatives appear in the side panel and can be edited, reordered, selected, or removed.

Selecting an option changes the passage inside the actual draft. Surrounding prose remains visible and reflows normally. The selection remains active after the panel closes and after the document reopens.

A marked passage indicates that options exist. A separate, accessible indicator identifies original versus alternate wording. Removing the final alternate leaves ordinary text without an empty annotation.

Candidate records retain human or AI origin. Editing an AI-origin candidate preserves that origin and records that a person edited it.

**Acceptance criteria**

- A short phrase can be replaced by a longer alternative without changing text outside the selected passage.
- Returning to the original restores its captured wording.
- Edits before or after a marked passage do not detach its alternatives.
- Removing an active alternate returns to the original; undo restores the removed option and selection.
- Variant ranges cannot overlap or nest in P0. A conflicting selection opens the existing variant or explains why a new one cannot be created.
- Editing an active alternate updates that candidate. Editing the original creates one human alternate for that editing session, preserving the original snapshot.

## F2 Set text aside and restore it

The writer can mark a selected passage as temporarily excluded from the active draft. The passage stays in its original location, appears muted, and can be restored.

The writer can distinguish manually hidden text from AI-proposed cuts. Reviewing a new AI request must not erase manual hiding decisions.

**Acceptance criteria**

- Hiding and restoring text do not destroy its contents.
- Muted text has an accessible label and can be inspected at full contrast.
- Hiding may contain an entire variant, preserving its options and active choice. It cannot split a variant range.
- Undo restores the exact preceding text and annotation state.
- Clean export omits manually hidden passages.

## F3 Keep overflow near the draft

Overflow is a separate editable area for discarded paragraphs, notes, wording ideas, or an outline. It is not appended to the main document.

The writer can move a selection into overflow, copy material back, or move material back at the current insertion point.

**Acceptance criteria**

- Moving text is one undoable action: it appears in overflow and leaves the main draft atomically.
- Ordinary copying keeps the source intact.
- Overflow persists independently of whether its panel is open.
- P0 treats overflow as plain text. If a move would discard variant or hiding metadata, the action must offer a plain-text copy instead of silently losing that metadata.
- Overflow does not affect the main word count, clean export, or an AI request unless the writer explicitly includes it.

## F4 Save and reopen the complete document

Autosave the structured document locally after changes. Confirm save completion visibly; show a persistent error if storage fails. A quiet editor must not conceal an unsaved state.

Provide a portable native document export, proposed as a versioned `.draft.json` file. It contains the draft, original wording, alternatives, active selections, hiding states, overflow, and document preferences. Also provide clean plain-text and Markdown exports.

**Acceptance criteria**

- Native export/import reproduces the complete editing state.
- Clean export contains only active main-draft wording, with hidden passages and overflow excluded.
- Reopening a saved document preserves the selected alternatives.
- Invalid imports fail without modifying the open document. Unsupported newer versions produce an explanatory error.
- Local recovery retains the last confirmed save after an interrupted session.
- Exporting a document never publishes it.

## F5 Generate optional AI alternatives

AI suggestions are explicitly requested for a selection. Show them as candidates; do not automatically replace the active text. Distinguish their origin with text or an accessible label, not color alone.

Send the selected passage and the surrounding paragraph needed to interpret it. Do not include overflow or the rest of the document by default. The writer can inspect the scope of text being sent before enabling AI.

**Acceptance criteria**

- Request, loading, completed, empty, and failed states are visible without blocking ordinary writing.
- Generated alternatives are separate from human-authored options.
- Canceling or dismissing a request leaves the draft unchanged.
- The response is associated with the document revision that initiated it.
- If that selection or context changes before the response arrives, require a new request rather than applying results to the changed text.
- Provider errors preserve all existing candidates and draft contents.

## F6 Review cuts without rewriting

The Editing panel offers graduated trimming, from a light reduction to a target near half the current length. These are approximate targets, not promised exact percentages.

The result is a preview of proposed removals. Surviving prose remains verbatim. The writer can accept or reject individual cuts, apply selected cuts, or dismiss the preview.

**Acceptance criteria**

- Previewing cuts does not commit a document change.
- Applying selected cuts is a single undoable action.
- Dismissing the preview preserves the draft and all manual hiding states.
- A new trim preview replaces only the previous uncommitted AI preview.
- Returned passages must match the captured source revision and valid document ranges. Reject stale, overlapping, or mismatched cuts rather than guessing.
- A proposed cut cannot split a variant node. Keep such a passage intact unless a valid whole-node cut is offered.
- The interface reports projected words removed. AI may recommend no cuts.

## F7 Identify sentences and words to review

AI can flag sentences that are hard to follow and words that appear inconsistent with the surrounding tone. Highlight the exact passage and give a short reason.

Suggestions are advisory. The writer can dismiss them or manually revise the passage. V1 does not automatically rewrite flagged sentences.

## F8 Assist with English articles

When an alternate changes the following noun phrase, the editor may suggest an accompanying change between “a” and “an.” Treat this as an English-language convenience, not a general grammar checker.

Use pronunciation-aware cases where supported. Leave uncertain cases unchanged. Keep article and candidate changes in one undoable action, preserve capitalization, and indicate any adjustment outside the selected phrase.

# Interaction and data rules

| Entity | Required information |
| --- | --- |
| Document | Stable ID, title, structured body, revision, format version, and save state. |
| Variant | Stable range/node ID, immutable original wording, alternate candidates, and active candidate or original selection. |
| Candidate | Stable ID, text, human/AI origin, and whether a human subsequently edited it. |
| Hidden passage | Stable range/node ID and explicit manual hiding state. |
| Overflow | Separate editable text associated with its document. |
| AI review | Captured document revision, request scope, proposed ranges/candidates, and review state. |

Ranges must follow edits through the editor’s document model rather than relying on unadjusted character offsets. Document revisions are required before accepting asynchronous AI results.

Every editing action must either preserve associated metadata or explain the conflict before modifying text. Copying plain text out of the app is allowed to omit metadata; saving the native document is not.

# Proposed platform and privacy defaults

Start with a desktop-focused web application and local persistence. Core editing, saving, and export work offline after the application is loaded. A native wrapper can be considered later; it is not required for the first release.

AI is optional and separately enabled. The interface identifies what text leaves the device and when. Editing checks and trimming use the active main draft; omit overflow, unused alternatives, and manually hidden passages. Avoid placing a shared provider credential in a shipped client bundle. Provider choice, credential handling, retention, and any service costs must be resolved before P1 ships.

Do not collect draft contents for analytics. A simple local-only product does not require behavioral telemetry for its first release.

# Release acceptance

P0 is ready when a writer can create a document, attach multiple alternatives, choose one in context, hide and restore a passage, move unannotated text into overflow, save and reopen the structured draft, and export the chosen result without losing text or metadata.

Run that workflow with keyboard-only interaction, a ten-thousand-word document, variants of different lengths, multi-paragraph selections, undo/redo, interrupted saving, and invalid import files.

P1 is ready when delayed, failed, canceled, and stale AI requests cannot alter the wrong revision; cut previews never rewrite surviving prose; and provenance remains visible after a person edits an AI suggestion.

Proposed performance targets are visible typing feedback within 100 ms and confirmed autosave within one second after typing pauses on the reference desktop. Define that reference machine before measuring these targets.

In an initial usability check, ask five writers to compare a phrase, recover an earlier version, set a passage aside, and reopen their draft without instruction. Record completion and any lost-context or lost-text failures. These are proposed validation activities, not completed results.

# Open decisions before implementation

| Decision | Proposed default |
| --- | --- |
| Initial platform | Desktop web app with local persistence. Confirm whether a macOS app is preferred before choosing the client stack. |
| First release boundary | Ship the manual P0 workflow before adding AI. |
| Draft ownership and sync | No account or synchronization in P0; native export provides portability. |
| AI provider and funding | Select before P1; keep all AI actions optional. |
| Tone reference | Use surrounding prose initially. A user-defined style profile is a later enhancement. |
| Distribution and license | Decide independently of the source creator’s stated plans. |
| External sharing | Defer X posting and other publishing integrations. |

# Suggested implementation order

1. Establish the document model, plain editing, persistence, native import/export, and undo.
2. Add stable variants and compare their selected wording inside the draft.
3. Add reversible hiding and overflow, including metadata-preserving boundary rules.
4. Complete keyboard behavior and run the P0 release workflow.
5. Add explicit AI requests, provenance, and revision checks.
6. Add cut previews, diagnostics, and article assistance; run P1 acceptance checks.
