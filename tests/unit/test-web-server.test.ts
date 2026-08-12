import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

describe('test web server input boundaries', () => {
  let server: TestWebServer;

  beforeEach(async () => {
    server = await startTestWebServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it.each(['-1', '1001', '1.5', 'not-a-number'])(
    'rejects an unsafe delay of %s milliseconds',
    async (delay) => {
      const response = await fetch(`${server.baseUrl}/delay?ms=${delay}`);

      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toContain('Invalid delay');
    },
  );

  it('allows bounded delays and HTML-escapes reflected values', async () => {
    const payload = '<script>globalThis.compromised=true</script>';
    const response = await fetch(
      `${server.baseUrl}/delay?ms=0&value=${encodeURIComponent(payload)}`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain(payload);
    expect(body).toContain('&lt;script&gt;globalThis.compromised=true&lt;/script&gt;');
  });

  it('HTML-escapes values persisted by the order fixture', async () => {
    const payload = '<img src=x onerror=globalThis.compromised=true>';
    const created = await fetch(
      `${server.baseUrl}/order-created?item=${encodeURIComponent(payload)}`,
    );
    const seller = await fetch(`${server.baseUrl}/seller`);
    const createdBody = await created.text();
    const sellerBody = await seller.text();

    expect(createdBody).not.toContain(payload);
    expect(sellerBody).not.toContain(payload);
    expect(createdBody).toContain('&lt;img src=x onerror=globalThis.compromised=true&gt;');
    expect(sellerBody).toContain('&lt;img src=x onerror=globalThis.compromised=true&gt;');
  });

  it('stores an identity through an escaped data attribute instead of executable source', async () => {
    const payload = `</script><script>globalThis.compromised=true</script>'"&`;
    const response = await fetch(`${server.baseUrl}/?value=${encodeURIComponent(payload)}`);
    const body = await response.text();

    expect(body).not.toContain('</script><script>');
    expect(body).not.toContain(`data-identity="${payload}"`);
    expect(body).not.toContain(`localStorage.setItem('identity', "${payload}")`);
    expect(body).toContain(
      'data-identity="&lt;/script&gt;&lt;script&gt;globalThis.compromised=true&lt;/script&gt;&#39;&quot;&amp;"',
    );
  });
});
