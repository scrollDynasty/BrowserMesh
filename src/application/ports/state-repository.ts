import type { BrowserStorageState } from '../../domain/models.js';

export interface SavedStateView {
  readonly stateId: string;
  readonly createdAt: string;
}

export interface StateRepositoryPort {
  save(stateId: string, state: BrowserStorageState): Promise<SavedStateView>;
  load(stateId: string): Promise<BrowserStorageState>;
  list(): Promise<readonly SavedStateView[]>;
  remove(stateId: string): Promise<void>;
}
