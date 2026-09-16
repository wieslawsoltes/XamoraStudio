import type { DesignDocument, ElementNode } from './index.js';
export interface RecordedProperty {
  id: string;
  path: string;
  value: unknown;
  baseValue?: unknown;
}
export interface CopiedKeyframe {
  trackId: string;
  time: number;
  node: ElementNode;
}
export declare function recordProperties(
  document: DesignDocument,
  storyId: string,
  changes: RecordedProperty[],
  time: number,
  options?: { baseDocument?: DesignDocument },
): string[];
export declare function shiftKeyframes(
  document: DesignDocument,
  storyId: string,
  keyIds: string[],
  delta: number,
  options?: { duplicate?: boolean },
): string[];
export declare function deleteKeyframes(
  document: DesignDocument,
  storyId: string,
  keyIds: string[],
): void;
export declare function editKeyframe(
  document: DesignDocument,
  storyId: string,
  keyId: string,
  options: {
    time?: number;
    value?: unknown;
    interpolation?: string;
    easing?: string;
    easingMode?: string;
    spline?: string;
  },
): string;
export declare function pasteKeyframes(
  document: DesignDocument,
  storyId: string,
  clipboard: CopiedKeyframe[],
  time: number,
): string[];
