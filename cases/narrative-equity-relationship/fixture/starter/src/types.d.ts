export type NodeKind = 'organization' | 'person' | 'metric';
export type RelationDirection = 'forward' | 'bidirectional' | 'mutual';

export interface NarrativeInput {
  title: string;
  overview: { nodes: unknown[]; edges: unknown[] };
  chapters: unknown[];
}

export interface NarrativeGraphApi {
  load(input: NarrativeInput): void;
  destroy(): void;
}
