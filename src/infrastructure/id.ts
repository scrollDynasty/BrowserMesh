import { randomUUID } from 'node:crypto';

export interface IdGenerator {
  next(prefix: string): string;
}

export const uuidGenerator: IdGenerator = {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  },
};
