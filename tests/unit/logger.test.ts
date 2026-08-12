import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { StructuredLogger } from '../../src/infrastructure/logger.js';

describe('StructuredLogger', () => {
  it('writes structured runtime events and honors silent mode', () => {
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString('utf8'));
        callback();
      },
    });
    const logger = new StructuredLogger('info', output);
    logger.emit({
      type: 'operation.completed',
      timestamp: '2026-08-12T00:00:00.000Z',
      operationId: 'operation_1',
      sessionId: 'session_1',
      pageId: 'page_1',
    });
    expect(JSON.parse(chunks.join(''))).toEqual({
      level: 'info',
      message: 'operation.completed',
      type: 'operation.completed',
      timestamp: '2026-08-12T00:00:00.000Z',
      operationId: 'operation_1',
      sessionId: 'session_1',
      pageId: 'page_1',
    });

    new StructuredLogger('silent', output).emit({
      type: 'operation.completed',
      timestamp: '2026-08-12T00:00:00.000Z',
    });
    expect(chunks).toHaveLength(1);
  });
});
