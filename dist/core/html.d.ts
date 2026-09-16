import type { DesignDocument, ElementNode, DesignNode } from './index.js';
export declare const HTML_VOID: Set<string>;
export declare const HTML_RAW: Set<string>;
export declare const HTML_TAGS: string[];
export declare const HTML_CSS: string[];
export declare function isHtml(document: DesignDocument): boolean;
export declare function parseHtml(
  source: string,
  options?: { name?: string; Parser?: typeof DOMParser },
): DesignDocument;
export declare function projectHtmlDocument(
  document: Document,
  options?: { name?: string; source?: string },
): DesignDocument;
export declare function serializeHtml(document: DesignDocument): string;
export declare function canonicalHtml(document: DesignDocument): string;
export declare function serializeHtmlNode(node: DesignNode, parent?: string): string;
export declare function formatHtml(
  source: string,
  options?: { name?: string; Parser?: typeof DOMParser },
): string;
export declare function newHtmlDocument(name?: string): DesignDocument;
export declare function htmlBody(document: DesignDocument): ElementNode;
export declare function htmlHead(document: DesignDocument): ElementNode;
export declare function htmlDiagnostics(
  document: DesignDocument,
): Array<{ id: string; line: number; severity: string; message: string }>;
export declare function cssDeclarations(source: string): string[];
export declare function setHtmlStyle(
  node: ElementNode,
  property: string,
  value: string | null,
  document?: Document,
): void;
export declare function moveHtmlNode(
  document: DesignDocument,
  nodeId: string,
  parentId: string,
  index?: number,
): void;
export declare function completeHtml(
  source: string,
  caret: number,
): Array<{
  label: string;
  detail: string;
  start: number;
  end: number;
  insertText: string;
  caretOffset?: number;
}>;
