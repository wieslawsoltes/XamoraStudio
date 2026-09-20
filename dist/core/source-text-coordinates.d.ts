/** Maps canonical source UTF-16 offsets to/from textarea LF-normalized offsets. */
export class SourceTextCoordinates {
  constructor(source: string);
  readonly source: string;
  readonly editorText: string;
  readonly newline: string;
  toSource(offset: number): number;
  toEditor(offset: number): number;
  fromEditor(text: string): string;
}
