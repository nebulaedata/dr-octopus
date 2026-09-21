# Attachment preflight

`inspectAttachment(input, source)` collects evidence; the existing attachment
capability resolver owns admission policy. This module does not access databases,
attachment IDs, job scheduling, or Blob storage. The module-level
`format-evidence.ts` adapter provides a path and fresh, optionally ranged streams.

- `index.ts`: format identification and evidence composition.
- `text.ts`: streaming strict UTF-8 validation.
- `image.ts`: bounded image dimensions.
- `office.ts`: existing bounded ZIP central-directory checks, without extracting entries.
- `pdf.ts`: disposable PDF child lifecycle, 30-second deadline and 512 MiB V8 heap limit.
- `pdf-child.ts` / `pdf-objects.ts`: PDF parsing and live catalog graph traversal.

PDF inspection uses the MIT-licensed `@cantoo/pdf-lib` because it exposes PDF
objects and supports empty-password decryption. The CommonJS export is loaded
explicitly for Node compatibility with bundled JSON resources. Parsed names are
decoded, including names in compressed object streams. Stream dictionaries are
inspected; binary payloads, literal strings, and obsolete objects outside the live
catalog graph are not scanned for keywords. Invalid reachable objects, unsupported
encryption/passwords, crashes, and timeouts produce invalid container evidence.

The existing conservative active/embedded-name policy remains unchanged, including
`OpenAction`. Preflight does not sanitize the original file or certify it as safe.
The child is process isolation with a V8 heap bound, not an OS sandbox or a total
RSS limit. The later extraction worker retains its own resource and output checks.

Regression tests live in `test/attachment-preflight.test.mjs`. Large private PDFs
are local acceptance inputs, not repository fixtures.
