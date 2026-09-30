---
name: imagegen
description: Generate new images or edit existing images with the image_generate tool, including follow-up changes to previously generated images and provider-specific OpenAI or Qwen limits.
---

# Image generation and editing

Use `image_generate` for user requests to generate images, edit uploaded images, or modify a previously generated image. The configured image service is independent of the conversation model. Follow the image service context for its active provider/model; do not infer it from the chat model or read credential files.

## Choose the operation

- Generate a new image: provide `prompt` without `referenceImages`.
- Edit an existing image: provide `prompt` and the original image path in `referenceImages`.
- Follow-up requests such as “改成 9:16 手机屏保”, “change its background”, or “keep this character but change the pose” refer to the preceding image. Obtain its path from the successful `image_generate` result and pass that path. A detailed text description alone is a new generation, not an edit.
- For successive edits, use the most recent successfully edited image unless the user refers to an earlier version. Failed calls produce no new reference image.
- Uploaded images use the materialized attachment `originalPath` / `original_path`. References must be workspace-local static PNG/JPEG/WebP files, totaling at most 8 MiB. Pass paths, never Base64 or remote URLs.
- If the intended original cannot be found, clarify which image to use. Do not silently omit the reference, substitute another image, or switch to text-only generation.

For a previous result at `generated-images/cat.png`, a wallpaper edit uses:

```json
{
  "prompt": "Edit this image into a vertical 9:16 phone wallpaper. Preserve the cat's identity and costume; extend the background and leave space for the clock.",
  "referenceImages": ["generated-images/cat.png"]
}
```

Describe the requested change and what must remain intact. Ask for the intended ratio or resolution in the prompt; this tool does not expose a size parameter, so verify the dimensions in the result rather than promising an exact size. Keep the default output directory unless the user specifies a destination.

## Provider distinctions

| Active image service | Generation                                                                       | Reference editing                                                                    |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| OpenAI GPT Image     | GPT Image model with no references                                               | Up to 4 references; GPT Image 2 also supports editing                                |
| Qwen Bailian         | Qwen model that supports text-to-image; edit-only models may require a reference | Up to 3 references; the tool accepts Qwen Image 2.0/3.0 and qwen-image-edit families |

Both providers use the same tool arguments. For multiple references, preserve their order and identify each one's role in the prompt. Do not drop a fourth reference to satisfy Qwen's limit; request the user's choice or report the limitation. The active model and API region must support the operation; matching a model family is not proof of remote availability.

The adapter owns provider protocols: OpenAI sends multipart `image[]`; for a single reference it may resend once as `image` after an explicit missing-image-field validation rejection. Qwen sends ordered image and text parts through DashScope. Do not manually call these endpoints, change providers, or repeat the adapter's compatibility fallback.

## Results and failures

Use the successful tool receipt's image paths, model and actual dimensions. Distinguish an edited original from a newly generated image; do not claim an edit succeeded unless the successful call included references.

When the tool fails, report the operation, status and available diagnostic reason. Do not automatically issue another billed request or replace an edit with text-to-image. Stop on `moderation_blocked` and report the safety rejection; do not rewrite the prompt to evade it. Authentication, rate-limit, unsupported-model and validation errors require resolving their stated cause before another attempt. A later user instruction can authorize a new attempt; a failed result does not.
