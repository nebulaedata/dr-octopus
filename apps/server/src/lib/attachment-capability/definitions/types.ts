/**
 * @author root
 * @description Defines immutable evidence, policy, capability, and resolution values for attachment admission.
 */

export type SupportedAttachmentFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'zip'
  | 'txt'
  | 'markdown'
  | 'json'
  | 'csv'
  | 'tsv'
  | 'source-code'
  | 'mp3'
  | 'wav'
  | 'ogg'
  | 'm4a'
  | 'mp4'
  | 'webm'
  | 'mov';

export type AttachmentProcessorCapability =
  | 'image-optimize'
  | 'pdf-text-extract'
  | 'office-text-extract'
  | 'archive-text-extract'
  | 'spreadsheet-structure-extract'
  | 'full-text-index';

export type AttachmentRetrievalCapability =
  'structured-file-read' | 'lexical-search' | 'semantic-vector-search';

export type AttachmentCapabilityCategory =
  'direct-image' | 'extractable-document' | 'manifest-only-binary' | 'rejected';

export type AgentDeliveryCapability =
  'rpc-image' | 'inline-text' | 'manifest-path' | 'manifest-only' | 'retrieval' | 'none';

export interface AttachmentEvidence {
  filename: string;
  byteSize: number;
  declaredMediaType?: string;
  detectedMediaType: string;
  extension?: string;
  sha256?: string;
  formatEvidence: {
    detectedFormat: SupportedAttachmentFormat | 'unknown';
    extensionMatched: boolean;
    mediaTypeMatched: boolean;
    magicMatched: boolean;
    containerMatched?: boolean;
  };
  structure?: {
    width?: number;
    height?: number;
    pageCount?: number;
    sheetCount?: number;
    entryCount?: number;
    uncompressedBytes?: number;
    compressionRatio?: number;
    hasMacros?: boolean;
    hasActiveContent?: boolean;
    hasEmbeddedObject?: boolean;
    hasExternalRelationships?: boolean;
  };
}

export interface AttachmentSecurityPolicy {
  version: string;
  allowedFormats: ReadonlySet<SupportedAttachmentFormat>;
  deniedFormats: ReadonlySet<SupportedAttachmentFormat>;
  maxAttachmentBytes: number;
  maxImagePixels: number;
  maxDocumentPages: number;
  maxInlineCharacters: number;
  allowMaterialization: boolean;
}

export interface AttachmentResolutionContext {
  processors: ReadonlySet<AttachmentProcessorCapability>;
  retrieval: ReadonlySet<AttachmentRetrievalCapability>;
  tools: ReadonlySet<'read-file' | 'shell'>;
  policy: AttachmentSecurityPolicy;
  agent?: {
    modelInputs: ReadonlySet<'text' | 'image'>;
    maxContextCharacters: number;
  };
}

export type AttachmentCapabilityDiagnosticCode =
  | 'ATTACHMENT_EXTENSION_MISMATCH'
  | 'ATTACHMENT_MEDIA_TYPE_MISMATCH'
  | 'ATTACHMENT_MAGIC_MISMATCH'
  | 'ATTACHMENT_CONTAINER_INVALID'
  | 'ATTACHMENT_ACTIVE_CONTENT_FORBIDDEN'
  | 'ATTACHMENT_TYPE_UNSUPPORTED'
  | 'ATTACHMENT_PROCESSOR_UNAVAILABLE'
  | 'ATTACHMENT_POLICY_REJECTED'
  | 'ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED'
  | 'ATTACHMENT_INLINE_BUDGET_EXCEEDED'
  | 'MODEL_INPUT_UNSUPPORTED'
  | 'AGENT_TOOL_UNAVAILABLE';

export interface AttachmentCapabilityDiagnostic {
  code: AttachmentCapabilityDiagnosticCode;
  severity: 'info' | 'warning' | 'error';
  retryable: boolean;
  message: string;
}

export interface AttachmentCapabilityResolution {
  category: AttachmentCapabilityCategory;
  decision: 'allow' | 'defer' | 'reject';
  detectedMediaType: string;
  processingPlan: { steps: AttachmentProcessorCapability[]; required: boolean };
  deliveryCapabilities: AgentDeliveryCapability[];
  limits: { maxDerivedImageBytes?: number; maxInlineCharacters?: number; maxPages?: number };
  diagnostics: AttachmentCapabilityDiagnostic[];
  policyVersion: string;
  ruleVersion: string;
}
