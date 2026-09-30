# Image generation

`image_generate` is an ordinary built-in Pi tool for main CLI and RPC sessions. The conversation model orchestrates the operation; the independent image service generates or edits images. Child and scheduled-task tool sets do not include it.

The extension automatically registers its bundled imagegen skill through Pi resources_discover at startup and reload. Pi includes the skill name, description and location in its skill catalogue; the agent reads SKILL.md on demand before calling image_generate. The extension does not inject the skill body into the system prompt. While image_generate is active, before_agent_start adds only a fresh redacted enabled/provider/model snapshot. Follow-up edits must carry the previous image path; OpenAI and Qwen limits remain distinct. Build copies the skill alongside the compiled extension for both CLI and RPC sessions.

## Independent configuration

Settings → Image service (`/settings/imagegen`) follows the speech settings pattern: OpenAI and Qwen tabs retain independent endpoint, model and API key values; viewing a tab never activates it. Save and use selects the service explicitly. A separate enable switch controls execution. The default-model page only selects the conversation model.

The active Agent directory owns `imagegen.json`: `{ version: 1, enabled, activeProvider, providers: { openai, qwen } }`. Each provider stores `{ baseUrl, model, apiKey }`. This configuration is independent of Pi chat providers, auth.json, capability flags and models.json. Keys remain local and are never returned by the settings API. Writes use restrictive permissions, a per-directory queue, revision checks and atomic replacement. Omitted keys are retained; null removes a key. Enabling requires the selected service's key. Each invocation reads a fresh complete snapshot, with no model or credential fallback.

The Server's `imagegen-settings` module exposes `GET/PUT /api/settings/imagegen`, delegates complete configuration operations to the Agent SDK and localizes safe errors. The old DELETE and candidate-list endpoints are removed. Only the current versioned document is accepted. Missing files use disabled defaults; unsupported or corrupt documents fail validation. There is no legacy conversion or fallback.

## Supported protocols

Only OpenAI GPT Image and Qwen Image services are supported. There is no editable capability flag, chat model catalog dependency, Gemini adapter or OpenRouter adapter.

| Service      | Generation                                                                                     | Reference editing                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| OpenAI       | `POST {baseUrl}/images/generations`, JSON model/prompt/n                                       | `POST {baseUrl}/images/edits`, multipart model/prompt and binary image[]                                                     |
| Qwen Bailian | `POST {baseUrl}/services/aigc/multimodal-generation/generation`, input.messages with user text | Same endpoint with ordered Base64 image parts followed by text; Qwen Image 2.0/3.0 and edit models, at most three references |

Qwen follows the official [DashScope synchronous image generation and editing contract](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference). Its regional API base URL ends in `/api/v1`; OpenAI's base URL includes `/v1`. Model and key must belong to the endpoint's region. Defaults are GPT Image 1.5 and Qwen Image 3.0 Pro; model fields allow supported family IDs to be changed as accounts and availability evolve.

Pi's public image types remain the adapter boundary. OpenAI base64 output and Qwen HTTPS image URLs are converted to the same image content. Image downloads never receive the API key. Requests do not follow redirects or retry billed operations. Single-image OpenAI edits first send image[]. Only an HTTP 422 validation envelope whose errors all identify the missing body.image field permits one resend with image; the model, prompt and file are preserved. Multi-image edits, Qwen requests, ambiguous errors, network failures and cancellation never trigger this compatibility resend. An unsupported reference operation fails before transport rather than dropping images or switching protocols.

## Files, presentation and failure handling

References are workspace-local static PNG/JPEG/WebP files, up to four (Qwen: three) and 8 MiB total. Uploaded files use materialized original paths. Output defaults to `generated-images/`; image decoding precedes atomic no-overwrite publication. Cancellation and write errors remove only outputs from that invocation. Provider requests have a three-minute timeout.

Receipts retain version, provider/model, paths, dimensions and MIME types, never base64. Existing live and restored previews use the same receipt; moving or deleting files leaves an explicit missing-image state. Workspace image preview and download endpoints keep their existing boundaries.

Failures retain operation, protocol, model and bounded sanitized diagnostics. Credentials, prompt text and image payloads are removed from provider errors. No real provider generation is performed by deterministic regressions; passing payload and mocked execution tests does not establish account access or real remote availability.

## Verification

Tests cover independent keys and activation, revision conflicts, key redaction/removal, unsupported document rejection, strict provider selection, OpenAI generation and multipart edits, Qwen text and reference payloads, key-free downloads, cancellation, bounded diagnostics, fresh configuration reads, file boundaries and durable receipts.
