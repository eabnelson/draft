# Rune library used by Draft

`rune/` contains the library source, assets, and MIT license from Anomaly's
[`7ead7d63fcf6f9dd9669385a8b90e2ae80015d7b`](https://github.com/anomalyco/rune/tree/7ead7d63fcf6f9dd9669385a8b90e2ae80015d7b/crates/rune).
Sibling Rune crates still use that exact Git revision. The standalone manifest
replaces workspace inheritance and omits upstream integration-test targets.

Draft needs one editor buffer for text, selection, composition, and undo even
when images appear between paragraphs. The small library extension adds an
in-flow attachment box to a `Span`, includes its size in shaping/cache keys,
and exposes its geometry through a keyed text highlight. Draft paints its native
image/crop control at that geometry while preserving the Markdown source bytes.

Mesa/Vulkan rendering also exposed a required half-float capability in the
upstream clip shader. The clip and video shaders now decode packed half values
with integer operations, preserving their float32 values without requiring f16
shader support. macOS glass-color comparisons and Linux software-Vulkan frame
rendering cover the two rendering paths.

[`rune-draft.patch`](rune-draft.patch) records every change against the pinned
library, including manifest changes. When updating Rune, reapply or retire those
changes and run the native interaction, inline-media, and GPU checks described
in the [native app README](../rune-prototype/README.md). The app's checks exercise
this extension; they do not replace upstream Rune's full test suite.
