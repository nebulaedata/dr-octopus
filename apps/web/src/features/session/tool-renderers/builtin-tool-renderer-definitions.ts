/**
 * @author Codex
 * @description Maps Pi built-in tool names to their presentation components and summaries.
 */

import {
  FilePenLineIcon,
  FileSearchIcon,
  FileTextIcon,
  FileUpIcon,
  FolderSearchIcon,
  ListTreeIcon,
  TerminalIcon,
} from 'lucide-react';
import {
  BashToolRenderer,
  EditToolRenderer,
  ReadToolRenderer,
  SearchToolRenderer,
  WriteToolRenderer,
} from './BuiltinToolRenderers';
import { FallbackToolRenderer } from './ToolRendererParts';
import { summarizeCommand, summarizePath, summarizeSearch } from './tool-renderer-utils';
import type { ToolRendererDefinition } from './types';

export const BUILTIN_TOOL_RENDERERS: readonly ToolRendererDefinition[] = [
  { names: ['bash'], component: BashToolRenderer, icon: TerminalIcon, summarize: summarizeCommand },
  { names: ['read'], component: ReadToolRenderer, icon: FileTextIcon, summarize: summarizePath },
  { names: ['edit'], component: EditToolRenderer, icon: FilePenLineIcon, summarize: summarizePath },
  { names: ['write'], component: WriteToolRenderer, icon: FileUpIcon, summarize: summarizePath },
  { names: ['grep'], component: SearchToolRenderer, icon: FileSearchIcon, summarize: summarizeSearch },
  { names: ['find'], component: SearchToolRenderer, icon: FolderSearchIcon, summarize: summarizeSearch },
  { names: ['ls'], component: SearchToolRenderer, icon: ListTreeIcon, summarize: summarizePath },
];

export const FALLBACK_TOOL_RENDERER: ToolRendererDefinition = {
  names: [],
  component: FallbackToolRenderer,
  icon: TerminalIcon,
};
