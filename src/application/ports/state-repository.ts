import type { JsonValue } from '../../domain/models.js';

export interface SavedStateView {
  readonly name: string;
  readonly createdAt: string;
}

export interface StateRepositoryPort {
  save(name: string, state: JsonValue): Promise<SavedStateView>;
  load(name: string): Promise<JsonValue>;
  list(): Promise<readonly SavedStateView[]>;
  remove(name: string): Promise<void>;
}
