# Image generation

`image_generate` is an ordinary built-in Pi tool, available in the main CLI and RPC sessions. The chat model orchestrates the request; the separate image model generates or edits the image. Child and scheduled-task tool sets do not include it.

The Agent owns `imagegen.json` in the active agent directory and exports configuration and catalog operations for Server. The document is either `null` or `{ providerId, modelId, adapter }`. It contains no credential or endpoint copy. Saves use a per-directory write queue and atomic replacement. Each invocation refreshes local provider configuration, resolves authentication and fixes its own request snapshot. Failed or unavailable selections never fall back to another provider.

Pi 0.85.1 supplies the image contract and OpenRouter implementation. OpenAI Images and Gemini generateContent are adapters to the same contract. Native provider identity selects the protocol; custom services require explicit OpenAI Images confirmation. The initial OpenAI image catalog includes GPT Image 1 and 1.5; Google image candidates use the Pi catalog. Explicit custom image capability declarations remain authoritative. API Key authentication is required; chat subscription OAuth credentials are not assumed to authorize image APIs.

## Adapter selection and reference editing

Adapter selection follows provider identity and the explicitly saved protocol, not the model name or the provider's chat API type. `imagegen.json` persists the chosen `adapter`; execution checks it against the current catalog before calling the provider. A model named `gpt-image-2` does not automatically select an adapter or prove that a third-party service supports editing.

| Provider path                                                    | Adapter         | Text to image                                                           | Reference image editing                                                                                                                   |
| ---------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Native OpenAI                                                    | `openai-images` | JSON `POST {baseUrl}/images/generations` with `model`, `prompt`, `n: 1` | Multipart `POST {baseUrl}/images/edits` with `model`, `prompt` and repeated binary `image[]` fields, including for a single image         |
| Native Google Gemini                                             | `google-gemini` | `generateContent` with a text part                                      | The same endpoint with ordered text and `inlineData` parts containing image Base64 and MIME type; `responseModalities: ['TEXT', 'IMAGE']` |
| Native OpenRouter                                                | `openrouter`    | Pi's built-in Images provider                                           | Pi's built-in Images provider receives text and reference image content through the unified image contract                                |
| Custom service explicitly configured as OpenAI Images compatible | `openai-images` | Same OpenAI generation request                                          | Same OpenAI multipart edit request; no service-specific parameter conversion                                                              |

There are three execution adapters, not a dedicated adapter for every reseller. MrToken currently uses the custom OpenAI Images path. The implementation does not automatically try `image` instead of `image[]`, upload URLs instead of files, or alternative Base64 payloads after a failure. Any service-specific adaptation requires an established API contract; switching parameters and retrying can duplicate billed requests.

Model names participate only in limited candidate discovery: known OpenAI image models are supplemented explicitly, and native Google model IDs containing `-image` are candidates when their capability has not been explicitly disabled. Reference support is derived from the model's declared image input capability. These catalog indicators are not live compatibility probes. A service may accept text generation while rejecting its advertised image editing route.

The tool accepts `prompt`, optional `referenceImages` paths and an optional `outputDirectory`. Nonempty references always use the edit path; unsupported reference input fails instead of silently becoming text-to-image. Mask editing and provider-specific size/quality parameters are not exposed.

## Files and presentation

References are workspace-local static PNG/JPEG/WebP images, up to four and 8 MiB in total. Uploaded attachments use their existing materialized original paths. Text-only conversation models receive an honest manifest instead of image blocks. Output defaults to `generated-images/` inside the workspace. Actual image decoding precedes publication; UUID filenames and atomic no-overwrite publication prevent collisions. Cancellation and write failures remove files published by that invocation. Provider requests have a three-minute timeout and no automatic retries.

The Server exposes `GET/PUT/DELETE /api/settings/imagegen`, `GET /api/settings/imagegen/candidates`, and `GET /api/workspaces/:workspaceId/files/image?path=...`. Preview resolves the canonical workspace boundary, validates the raster format and uses the existing workspace access boundary. Download uses the workspace download endpoint.

Tool receipts store `version: 1`, the actual provider/model and image paths, dimensions and MIME types in `details`. They store no image base64. The Web renderer uses the same receipt for live and restored messages, with explicit missing-file and generic fallback states. Files remain workspace-owned; moving or deleting them makes the historical preview unavailable.

Tests use isolated directories and mocked provider responses. They do not prove account access, current remote model availability or third-party protocol compatibility. Real provider generation is a separate opt-in smoke test with a configured account.

## Verification scope and known compatibility result

Deterministic tests cover request construction for all three adapters, image validation and publication, failures, cancellation and diagnostic redaction. They are separate from real provider verification.

As of 2026-09-25, real MrToken calls with `gpt-image-2` produced images for text-only prompts. One explicitly authorized browser test of reference editing returned HTTP 422; the failed tool card retained that status after reloading the conversation. That test made one image-tool call without retrying or dropping the reference. The captured diagnostic did not contain a specific rejected field or request ID, so it does not establish whether `image[]` is the cause, whether the reseller lacks editing support, or whether the request was billed. The earlier generic failure cannot be reconstructed from its saved result.

Direct OpenAI, Gemini and OpenRouter generation/editing have not been validated against real accounts in this implementation. OpenAI documents reference editing and multipart `image[]` in its [Images edit API](https://developers.openai.com/api/reference/resources/images/methods/edit); matching that contract is not a substitute for a successful real integration test.

## Failure diagnostics

Failed tool results retain the operation, adapter and model together with sanitized provider diagnostics. Direct HTTP adapters read at most 16 KiB of error JSON and select only code, type, parameter, message and request ID fields; non-JSON or oversized bodies retain status and header request ID only. Known request credentials, prompts, image payloads and URLs are redacted before the diagnostic is capped at 2048 characters. Both thrown Pi failures and returned error states use this path. Diagnostics do not change request parameters or trigger retries, and cannot recover details discarded by earlier invocations.
