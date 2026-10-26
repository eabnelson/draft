# Writing baseline correction

Date: October 26, 2026. Target build: 0.2.0-alpha.6.

The source of truth for the writing interaction is [Jason Fried’s original video](https://x.com/jasonfried/status/2105403067793584590), reviewed against the supplied 6:55 video file, its existing transcript, and the follow-up notes supplied by Erik. This is a correction to our implementation decisions, preserving the initial October 22 specification and transcript as historical records. Draft remains an independent project with the Studio Four visual theme and its existing local-agent and personal-update features.

The initial specification introduced decisions that differed from the video: one tabbed right panel, comparison arrows restricted to a focused control, plain-text overflow, and treating accepted cuts as another form of hiding. These are superseded below.

| Source | Required behavior |
| --- | --- |
| 0:00–0:31 | Begin as a quiet editor. Clicking the word count reveals editing tools. Turning them off retains the document’s annotations and chosen wordings. |
| 0:31–2:21 | Hover over marked wording and use arrow keys to cycle through alternatives in place. The left panel offers Word, Sentence, and Paragraph scopes. Options remain editable; human and AI origin remain distinguishable. |
| 1:35–1:52 | A subtle three-dot indicator identifies when the current wording is an alternative. Keep the original recoverable. |
| 1:57–2:15 | Cycle from paperclip to thumbtack to eraser and adjust the adjacent English article in the same undoable action. Preserve capitalization and leave uncertain pronunciation unchanged. |
| 2:21–2:53 | Right-click selected prose to Ghost it, fading it to approximately 10% contrast in place. Right-click to Revive it. Clean exports exclude ghosted prose. |
| 2:53–3:39 | Right-click for AI alternatives. Add suggestions without replacing the active wording. Distinguish a human bullet from an AI bot marker; preserve provenance when suggestions are edited. Undo removes the suggestion batch. |
| 3:39–4:31 | An independent right overflow panel holds spare writing. It may stay open with the alternatives panel. Moving unannotated text is atomic and undoable. Preserve the existing safety rule for passages with annotation history. |
| 4:47–5:59 | The Lab offers punctuation/typo correction, weakest/long/convoluted sentences, tone, and hedges/filler. Mark suggested passages in the draft. Trimming offers slight (~10%), tighter (~20%), sharper (~35%), and half (~50%) reductions. These are model targets, not promises. |
| 5:18–5:59 | Trim previews fade proposed omissions without rewriting surviving prose. Clicking a faded passage keeps it. Walk through scrolls to each suggestion. Make the cuts removes accepted passages as one undoable action. Dismiss/Original discards only the uncommitted preview. Manual ghosts remain independent. |
| Follow-up supplied by Erik | A higher tone accompanies alternatives; a lower tone identifies a return to the original. Sound failure must not interrupt writing. |
| Follow-up supplied by Erik | The draft, alternatives, and overflow all retain Markdown source and display formatted writing. A source toggle reveals Markdown. Native save retains every annotation; Markdown export retains formatting; plain-text export removes formatting. |
| Follow-up supplied by Erik | Typing `??` in the new alternative field requests AI ideas at the current word/sentence/paragraph scope. It is a shortcut to the same explicit request, including its cancellation and stale-result checks. |
| Erik’s addition | Right-click text for bold, italic, underline, strikethrough, or a link. Offer Text, Heading 1–3, numbered list, and bulleted list. Use Markdown syntax; underline is stored as `<u>…</u>`. Do not execute document HTML. Only web/mailto destinations may be inserted through the link control. |

## Compatibility and verification

Existing version-1 `.draft.json` files remain valid. Source offsets refer to Markdown characters; rendered formatting does not change the stored text. Preserve alternatives, origins, manual ghosts, and overflow through save/reopen, updates, and undo. Annotation ranges cannot overlap or nest; a conflicting scope change must explain the conflict without losing text.

Automated behavior checks cover article adjustment and range mapping, Markdown formatting/toggling and safe links, annotation round trips, selection scopes, tone distinction, and the existing document/update checks. Browser verification uses a separate local profile so real writing remains outside test fixtures. Live AI checks must use the configured provider and report actual results; failed, cancelled, or stale requests must preserve the draft.

The video’s X publication control and LinkedIn joke are not automatic publishing requirements. Draft retains explicit export and its separate Features page. This correction does not change signing/notarization status or claim that every interface detail is a pixel-for-pixel reproduction.

## Header and marker follow-up — October 26, 2026

In alpha 7, place the sidebar toggle at the far left of the app header. Show the Draft wordmark only while the alternatives sidebar is expanded. Place the three-dot wording indicator below the squiggle without reserving space in the line of text.

In alpha 8, center the indicator beneath the marked wording (beneath the final line for a wrapped passage). Show one dot for the original and each alternative, and mark the selected wording. Left/right arrows cycle through wordings in the draft and comparison controls; arrows in an editable alternative continue to move the text cursor.

In alpha 9, place the sidebar close control immediately to the right of the Draft wordmark. With the sidebar closed, show only the open control at the far left.

In alpha 10, use plain rounded sidebar icons without arrows: a full divider when open and a short inset bar when closed. Keep the toggle background transparent in both states, including hover.
