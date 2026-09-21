/**
 * @author Codex
 * @description Regresses PDF binary false positives and preserves format-specific attachment admission checks.
 */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import sharp from 'sharp';
import { zipSync } from 'fflate';
import { inspectAttachment } from '../dist/lib/attachment-preflight/index.js';
import {
  createAttachmentCapabilityResolver,
  DEFAULT_ATTACHMENT_POLICY,
} from '../dist/lib/attachment-capability/index.js';

const { PDFDocument, PDFName, PDFString } = createRequire(import.meta.url)('@cantoo/pdf-lib');

/**
 * Inspects a temporary source using only the public read-only preflight contract.
 */
async function inspect(t, bytes, name = 'fixture.pdf') {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-preflight-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, name);
  await writeFile(path, bytes);
  return inspectAttachment(
    { name, byteSize: bytes.length, sha256: '0'.repeat(64) },
    {
      path,
      /**
       * Opens a fresh stream with optional inclusive byte bounds.
       */
      openRead: async (range) => ({ stream: createReadStream(path, range) }),
    }
  );
}

/**
 * Builds a deterministic one-page PDF with fixed metadata and optional object customization.
 */
async function pdfFixture(customize = () => {}, useObjectStreams = false) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2020-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  pdf.addPage([100, 100]);
  await customize(pdf);
  return pdf.save({ useObjectStreams });
}

test('PDF preflight ignores script markers and fake page syntax in opaque image streams and strings', async (t) => {
  const tokens = '/JS /AA /OpenAction /JavaScript /Launch /EmbeddedFile /Filespec /RichMedia /Type /Page';
  const bytes = await pdfFixture((pdf) => {
    const stream = pdf.context.stream(Buffer.from(tokens), {
      Type: 'XObject',
      Subtype: 'Image',
      Filter: 'DCTDecode',
      Width: 1,
      Height: 1,
    });
    pdf.catalog.set(PDFName.of('FixtureImage'), pdf.context.register(stream));
    pdf.catalog.set(PDFName.of('Description'), PDFString.of(tokens));
  });
  const evidence = await inspect(t, bytes);
  assert.equal(evidence.formatEvidence.containerMatched, true);
  assert.deepEqual(evidence.structure, { pageCount: 1, hasActiveContent: false, hasEmbeddedObject: false });
});

for (const useObjectStreams of [false, true]) {
  for (const name of ['JS', 'JavaScript', 'OpenAction', 'AA', 'Launch']) {
    test(`PDF preflight retains ${name} rejection (object streams: ${useObjectStreams})`, async (t) => {
      const bytes = await pdfFixture((pdf) => {
        pdf.catalog.set(PDFName.of(name), pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('void(0)') }));
      }, useObjectStreams);
      const evidence = await inspect(t, bytes);
      assert.equal(evidence.formatEvidence.containerMatched, true);
      assert.equal(evidence.structure.hasActiveContent, true);
    });
  }
}

test('PDF preflight decodes escaped names', async (t) => {
  const bytes = await pdfFixture((pdf) => pdf.catalog.set(PDFName.of('JS'), PDFString.of('void(0)')));
  const escaped = Buffer.from(Buffer.from(bytes).toString('latin1').replace('/JS ', '/J#53 '), 'latin1');
  assert.equal((await inspect(t, escaped)).structure.hasActiveContent, true);
});

test('PDF preflight checks stream dictionaries for embedded files', async (t) => {
  const bytes = await pdfFixture((pdf) => {
    pdf.catalog.set(
      PDFName.of('FixtureAttachment'),
      pdf.context.register(pdf.context.stream(Buffer.from('payload'), { Type: 'EmbeddedFile' }))
    );
  }, true);
  const evidence = await inspect(t, bytes);
  assert.equal(evidence.structure.hasEmbeddedObject, true);
  const resolution = createAttachmentCapabilityResolver().resolve(evidence, {
    processors: new Set(['pdf-text-extract', 'full-text-index']),
    retrieval: new Set(['structured-file-read', 'lexical-search']),
    tools: new Set(['read-file']),
    policy: DEFAULT_ATTACHMENT_POLICY,
  });
  assert.equal(resolution.decision, 'reject');
  assert.equal(resolution.diagnostics[0].code, 'ATTACHMENT_ACTIVE_CONTENT_FORBIDDEN');
});

test('Malformed PDFs produce invalid evidence and are rejected by the admission policy', async (t) => {
  const evidence = await inspect(t, Buffer.from('%PDF-1.7\nnot a document\n%%EOF'));
  assert.equal(evidence.formatEvidence.containerMatched, false);
  const resolution = createAttachmentCapabilityResolver().resolve(evidence, {
    processors: new Set(['pdf-text-extract', 'full-text-index']),
    retrieval: new Set(['structured-file-read', 'lexical-search']),
    tools: new Set(['read-file']),
    policy: DEFAULT_ATTACHMENT_POLICY,
  });
  assert.equal(resolution.decision, 'reject');
  assert.equal(resolution.diagnostics[0].code, 'ATTACHMENT_CONTAINER_INVALID');
});

test('Text preflight retains UTF-8 validation', async (t) => {
  assert.equal((await inspect(t, Buffer.from('hello'), 'fixture.txt')).formatEvidence.magicMatched, true);
  assert.equal(
    (await inspect(t, Buffer.from([0xff, 0xfe, 0x80]), 'fixture.txt')).formatEvidence.magicMatched,
    false
  );
});

test('Image preflight retains dimensions', async (t) => {
  const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  assert.deepEqual((await inspect(t, bytes, 'fixture.png')).structure, { width: 4, height: 3 });
});

for (const active of [false, true]) {
  test(`Empty-password encrypted PDFs retain structural inspection (active: ${active})`, async (t) => {
    const bytes = await pdfFixture(async (pdf) => {
      if (active) {
        pdf.catalog.set(PDFName.of('JS'), PDFString.of('void(0)'));
      }
      await pdf.encrypt({ userPassword: '', ownerPassword: 'fixture-owner', algorithm: 'AES-128' });
    }, true);
    const evidence = await inspect(t, bytes);
    assert.equal(evidence.formatEvidence.containerMatched, true);
    assert.equal(evidence.structure.pageCount, 1);
    assert.equal(evidence.structure.hasActiveContent, active);
  });
}

test('Password-protected PDFs do not silently pass preflight', async (t) => {
  const bytes = await pdfFixture(async (pdf) => {
    await pdf.encrypt({
      userPassword: 'required-password',
      ownerPassword: 'fixture-owner',
      algorithm: 'AES-128',
    });
  });
  assert.equal((await inspect(t, bytes)).formatEvidence.containerMatched, false);
});

for (const [extension, member] of [
  ['docx', 'word/document.xml'],
  ['xlsx', 'xl/workbook.xml'],
  ['pptx', 'ppt/presentation.xml'],
]) {
  test(`Office ${extension} embeddings are admitted while active content remains rejected`, async (t) => {
    const family = {
      docx: 'wordprocessingml.document',
      xlsx: 'spreadsheetml.sheet',
      pptx: 'presentationml.presentation',
    }[extension];
    const root = member.split('/')[0];
    const context = {
      processors: new Set(['office-text-extract', 'spreadsheet-structure-extract', 'full-text-index']),
      retrieval: new Set(['structured-file-read', 'lexical-search']),
      tools: new Set(['read-file']),
      policy: DEFAULT_ATTACHMENT_POLICY,
    };
    for (const forbidden of [undefined, `${root}/vbaProject.bin`, `${root}/activeX/activeX1.xml`]) {
      const bytes = zipSync(
        {
          '[Content_Types].xml': Buffer.from(
            `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${member}" ContentType="application/vnd.openxmlformats-officedocument.${family}.main+xml"/></Types>`
          ),
          [member]: Buffer.from('<document/>'),
          [`${root}/embeddings/oleObject1.bin`]: Buffer.from('opaque payload'),
          ...(forbidden ? { [forbidden]: Buffer.from('forbidden') } : {}),
        },
        { mtime: new Date('2020-01-01T00:00:00Z') }
      );
      const evidence = await inspect(t, bytes, `fixture.${extension}`);
      assert.equal(evidence.structure.hasEmbeddedObject, true);
      const resolution = createAttachmentCapabilityResolver().resolve(evidence, context);
      assert.equal(resolution.decision, forbidden ? 'reject' : 'allow');
      if (forbidden) {
        assert.equal(resolution.diagnostics[0].code, 'ATTACHMENT_ACTIVE_CONTENT_FORBIDDEN');
      }
    }
  });
  test(`Office preflight retains ${extension} container and macro evidence`, async (t) => {
    const family = {
      docx: 'wordprocessingml.document',
      xlsx: 'spreadsheetml.sheet',
      pptx: 'presentationml.presentation',
    }[extension];
    const bytes = zipSync(
      {
        '[Content_Types].xml': Buffer.from(
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${member}" ContentType="application/vnd.openxmlformats-officedocument.${family}.main+xml"/></Types>`
        ),
        [member]: Buffer.from('<document/>'),
        'word/vbaProject.bin': Buffer.from('macro'),
      },
      { mtime: new Date('2020-01-01T00:00:00Z') }
    );
    const evidence = await inspect(t, bytes, `fixture.${extension}`);
    assert.equal(evidence.formatEvidence.containerMatched, true);
    assert.equal(evidence.structure.hasMacros, true);
    assert.equal(evidence.structure.entryCount, 3);
  });
}
