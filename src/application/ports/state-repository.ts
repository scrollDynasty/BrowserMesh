import type { BrowserStorageState } from '../../domain/models.js';

export interface SavedStateView {
  readonly name: string;
  readonly createdAt: string;
}

export interface StateRepositoryPort {
  save(name: string, state: BrowserStorageState): Promise<SavedStateView>;
  load(name: string): Promise<BrowserStorageState>;
  list(): Promise<readonly SavedStateView[]>;
  remove(name: string): Promise<void>;
}
