import type {Catalog,Handoff,Update,Version,AgentSelection} from './types';

const quote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;

export function featureHandoffPrompt(context:{handoff:Handoff;original:Update;latest:Update;active:Version;official:Catalog;bun:string;selection?:AgentSelection}){
  const {handoff,original,latest,active,official,bun,selection}=context;
  const progress={
    feature:latest.title,
    originalRequest:original.request,
    requestedChanges:original.requests??null,
    completedChanges:latest.featureResults??original.featureResults??null,
    requestedAction:original.kind,
    featureId:latest.featureId??original.featureId??original.existingFeatureId??null,
    currentStage:latest.state,
    lastResult:latest.summary??null,
    lastProblem:latest.error??null,
    checks:latest.checks??[],
    model:selection??null,
    appVersion:active.catalog.appVersion,
    activeVersion:active.id,
    sourceBeingEdited:handoff.workspace,
    workingCopyCreated:handoff.createdAt,
    previousWorkingCopy:handoff.previousWorkspace??null,
    officialFeatures:official.features,
    installedFeatures:active.catalog.features,
  };
  return `Help me keep working on a feature for Draft, my local macOS writing app.

First ask me what I would like to change about the feature. Wait for my feedback before editing. The original request and progress below are background, not a request to repeat completed work.

Work in this separate editable copy:
${handoff.workspace}

Draft is still running its current version. Your edits will be checked and offered as a new app update when I return to Draft. Keep my other features and writing intact.

Current context:
${JSON.stringify(progress,null,2)}

After I explain what I want:
1. If previousWorkingCopy is present, it holds earlier work preserved when the app changed; use it as a read-only reference while adapting the changes to the current working copy. Read features.json and the relevant implementation and tests in this working copy. Read docs/feature-builder.md for the app's feature conventions; use the context here for this handoff's workflow. The initial writing spec is docs/initial-product-spec.md and the current baseline is docs/draft-product-spec-2026-10-24.md.
2. Finish the requested behavior in src/ and, if needed, src/runtime.ts. Update the same high-level feature entries, stable identities, states, and timestamps in features.json. Preserve other personal changes and document compatibility. Add meaningful behavior checks. For a batch update, account for every requestedChanges entry and write .draft-update.json with {"outcome":"implemented","title":"short title","summary":"plain-language result","features":[{"requestId":"the request id","featureId":"stable feature id","outcome":"implemented"}]}. Include exactly one mapping for each request; use already_exists only for behavior already available in the running app.
3. Edit only this working copy. App versions, real writing documents, login credentials, and Draft's activation record are outside this task. Leave desktop/, scripts/, and src-tauri/ unchanged; native-shell changes need a separately packaged app. Do not replace or edit the shared node_modules directory. If dependencies need changing, update the package manifest and lockfile; Draft will prepare them in an isolated copy.
4. Use the bundled runtime for local checks; no global Node or Bun installation is required:
   cd ${quote(handoff.workspace)}
   ${quote(bun)} test ./tests
   ${quote(bun)} node_modules/typescript/bin/tsc -b
   ${quote(bun)} node_modules/vite/bin/vite.js build --configLoader native
   ${quote(bun)} build src/runtime.ts --target=bun --outfile dist/runtime.js
5. Summarize the result in plain language. Tell me to return to Draft, choose “Check my changes”, and then choose “Restart to update” when it is ready. Draft copies and independently checks your work before offering it. It does not automatically apply your edits. If my app has changed since this copy was created, keep this work intact and ask me to copy a fresh prompt from Draft.
`;
}
