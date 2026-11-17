# Graph Report - NotchCopy  (2026-11-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 290 nodes · 696 edges · 10 communities (8 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2b80a4d4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9

## God Nodes (most connected - your core abstractions)
1. `TeleprompterApi` - 39 edges
2. `WhisperSttService` - 25 edges
3. `AiSecretStore` - 23 edges
4. `runSelfTest()` - 20 edges
5. `AiProviderId` - 17 edges
6. `SttConfig` - 15 edges
7. `registerIpc()` - 14 edges
8. `DeepgramStreamingSession` - 13 edges
9. `AiProviderService` - 13 edges
10. `QaKnowledgeStore` - 12 edges

## Surprising Connections (you probably didn't know these)
- `StoredConfig` --references--> `AiProviderId`  [EXTRACTED]
  main/aiSecretStore.ts → shared/types.ts
- `QaPanelProps` --references--> `SttConfig`  [EXTRACTED]
  renderer/QaPanel.tsx → shared/types.ts
- `Persisted` --inherits--> `Settings`  [EXTRACTED]
  main/settingsStore.ts → shared/types.ts
- `Window` --references--> `TeleprompterApi`  [EXTRACTED]
  renderer/global.d.ts → shared/types.ts
- `AiSecretStore` --references--> `AiProviderId`  [EXTRACTED]
  main/aiSecretStore.ts → shared/types.ts

## Import Cycles
- None detected.

## Communities (10 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (18): buildDeepgramUrl(), DeepgramStreamingSession, TranscriptionProvider, RFC-6455, DEFAULT_STT_CONFIG, encodeWav16kMono(), execFileAsync, findExistingFile() (+10 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (35): aiProvider, applyPrivateNotes(), createOverlay(), dispatchShortcutAction(), eventLog, registerGlobalShortcuts(), registerIpc(), reopenOverlay() (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (25): AI_SPEED_HINTS, AiProviderService, buildHeaders(), CachedDiscovery, classifyHttpFailure(), classifyModelCapability(), classifyThrownFailure(), createReasoningFilter() (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (25): applyGlossary(), buildChunks(), CandidateChunk, damerauLevenshtein(), escapeRegExp(), expandQueryTokensWithFuzzy(), findApprovedMatch(), normalizeExact() (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (23): api, VALID_ACTIONS, VALID_PROVIDERS, downsampleTo16kInt16(), errorLabel(), int16ChunksToBase64(), QaMessage, QaMessageTimings (+15 more)

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (17): App(), Patch, STEP_PX, TopTab, CustomSelect(), CustomSelectOption, CustomSelectProps, MenuPos (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.21
Nodes (6): AiSecretStore, EncryptedSecretsMap, isValidProvider(), StoredConfig, VALID_PROVIDERS, AiConfigPatch

### Community 8 - "Community 8"
Cohesion: 0.25
Nodes (13): check(), click(), Ctx, js(), loaded(), results, runSelfTest(), scrollTop() (+5 more)

## Knowledge Gaps
- **41 isolated node(s):** `Bounds`, `CachedDiscovery`, `RawModelEntry`, `ResolvedEndpoint`, `SpeedHintRule` (+36 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 82 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TeleprompterApi` connect `Community 2` to `Community 5`?**
  _High betweenness centrality (0.231) - this node is a cross-community bridge._
- **Why does `WhisperSttService` connect `Community 0` to `Community 8`, `Community 1`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `SttConfig` connect `Community 0` to `Community 1`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `runSelfTest()` (e.g. with `.listModels()` and `.startStream()`) actually correct?**
  _`runSelfTest()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Bounds`, `CachedDiscovery`, `RawModelEntry` to the rest of the system?**
  _41 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08776595744680851 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08686868686868687 - nodes in this community are weakly interconnected._