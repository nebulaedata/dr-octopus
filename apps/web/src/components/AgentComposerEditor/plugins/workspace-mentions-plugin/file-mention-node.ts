/**
 * @author Codex
 * @description Implements an atomic, serializable Lexical text entity for Workspace file and directory references.
 */

import { $applyNodeReplacement, TextNode } from 'lexical';
import type { EditorConfig, LexicalNode, NodeKey, SerializedTextNode, Spread } from 'lexical';
import type { ComposerReference, ComposerReferenceKind } from '@/components/AgentComposerEditor/types';

export type SerializedFileMentionNode = Spread<
  {
    type: 'file-mention';
    version: 1;
    path: string;
    referenceKind: ComposerReferenceKind;
    label: string;
  },
  SerializedTextNode
>;

export class FileMentionNode extends TextNode {
  __path: string;
  __referenceKind: ComposerReferenceKind;
  __label: string;

  /**
   * Returns the stable serialized Lexical node type.
   */
  static getType(): string {
    return 'file-mention';
  }

  /**
   * Clones a mention without losing its structured Workspace identity.
   */
  static clone(node: FileMentionNode): FileMentionNode {
    return new FileMentionNode(node.__path, node.__referenceKind, node.__label, node.__key);
  }

  /**
   * Restores a mention from a persisted Lexical editor state.
   */
  static importJSON(serializedNode: SerializedFileMentionNode): FileMentionNode {
    return $createFileMentionNode({
      path: serializedNode.path,
      kind: serializedNode.referenceKind,
      label: serializedNode.label,
    }).updateFromJSON(serializedNode);
  }

  /**
   * Creates one atomic Workspace reference.
   */
  constructor(path: string, referenceKind: ComposerReferenceKind, label: string, key?: NodeKey) {
    super(`@${path}`, key);
    this.__path = path;
    this.__referenceKind = referenceKind;
    this.__label = label;
  }

  /**
   * Applies mention semantics and theme-compatible styling to its DOM representation.
   */
  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.className =
      'mx-0.5 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-foreground ring-1 ring-border';
    element.dataset.referenceKind = this.__referenceKind;
    element.dataset.referencePath = this.__path;
    element.spellcheck = false;
    return element;
  }

  /**
   * Exports the path and kind required to reconstruct a structured reference.
   */
  exportJSON(): SerializedFileMentionNode {
    return {
      ...super.exportJSON(),
      type: 'file-mention',
      version: 1,
      path: this.__path,
      referenceKind: this.__referenceKind,
      label: this.__label,
    };
  }

  /**
   * Returns the immutable reference represented by this node.
   */
  getReference(): ComposerReference {
    return {
      path: this.getLatest().__path,
      kind: this.getLatest().__referenceKind,
      label: this.getLatest().__label,
    };
  }

  /**
   * Marks the node as an indivisible text entity.
   */
  isTextEntity(): true {
    return true;
  }

  /**
   * Prevents regular text from entering the leading edge of the mention pill.
   */
  canInsertTextBefore(): false {
    return false;
  }

  /**
   * Prevents regular text from entering the trailing edge of the mention pill.
   */
  canInsertTextAfter(): false {
    return false;
  }
}

/**
 * Creates a segmented mention so one deletion gesture removes the complete reference.
 */
export function $createFileMentionNode(reference: ComposerReference): FileMentionNode {
  return $applyNodeReplacement(
    new FileMentionNode(reference.path, reference.kind, reference.label).setMode('segmented')
  );
}

/**
 * Narrows a Lexical node to the structured Workspace mention type.
 */
export function $isFileMentionNode(node: LexicalNode | null | undefined): node is FileMentionNode {
  return node instanceof FileMentionNode;
}
