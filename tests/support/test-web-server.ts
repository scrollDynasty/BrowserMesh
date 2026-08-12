import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import escapeHtml from 'escape-html';

const MAX_DELAY_MS = 1_000;

export interface TestWebServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startTestWebServer(): Promise<TestWebServer> {
  let barrierCount = 0;
  const barrierResponses: Array<() => void> = [];
  let order = '';
  let approved = false;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/barrier') {
      barrierCount += 1;
      barrierResponses.push(() =>
        response.end(page('Barrier', '<div data-testid="barrier">ready</div>')),
      );
      if (barrierCount >= 2) for (const release of barrierResponses.splice(0)) release();
      return;
    }
    if (url.pathname === '/delay') {
      const delayMs = Number(url.searchParams.get('ms') ?? '0');
      if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
        response.statusCode = 400;
        response.end(page('Bad request', '<div data-testid="error">Invalid delay</div>'));
        return;
      }
      const value = url.searchParams.get('value') ?? '';
      setTimeout(
        () =>
          response.end(
            page(`Delay ${value}`, `<div data-testid="delay">${escapeHtml(value)}</div>`),
          ),
        delayMs,
      );
      return;
    }
    if (url.pathname === '/buyer') {
      response.end(
        page(
          'Buyer',
          '<label>Item <input aria-label="Item" /></label><button onclick="location.href=`/order-created?item=${encodeURIComponent(document.querySelector(`input`).value)}`">Create order</button>',
        ),
      );
      return;
    }
    if (url.pathname === '/order-created') {
      order = url.searchParams.get('item') ?? '';
      response.end(page('Created', `<div data-testid="status">created:${escapeHtml(order)}</div>`));
      return;
    }
    if (url.pathname === '/seller') {
      response.end(
        page(
          'Seller',
          `<div data-testid="order">${escapeHtml(order)}</div><a href="/approved">Approve</a>`,
        ),
      );
      return;
    }
    if (url.pathname === '/approved') {
      approved = true;
      response.end(page('Approved', '<div data-testid="status">approved</div>'));
      return;
    }
    if (url.pathname === '/buyer-status') {
      response.end(
        page(
          'Buyer status',
          `<div data-testid="status">${approved ? 'approved' : 'pending'}</div>`,
        ),
      );
      return;
    }
    const value = url.searchParams.get('value');
    if (value !== null)
      response.setHeader(
        'set-cookie',
        `identity=${encodeURIComponent(value)}; Path=/; SameSite=Lax`,
      );
    const identityAttribute = value === null ? '' : ` data-identity="${escapeHtml(value)}"`;
    const initializeIdentity =
      value === null
        ? ''
        : "<script>localStorage.setItem('identity', document.querySelector('[data-testid=state]').dataset.identity ?? '')</script>";
    response.end(
      page(
        'BrowserMesh Test',
        `<div data-testid="state"${identityAttribute}></div>${initializeIdentity}<label>Name <input aria-label="Name" placeholder="Your name" /></label><button onclick="document.querySelector('[data-testid=status]').textContent='clicked'">Submit</button><div data-testid="status"></div><select aria-label="Choice"><option value="one">One</option><option value="two">Two</option></select><script>document.querySelector('[data-testid=state]').textContent=(localStorage.getItem('identity')||'')+'|'+document.cookie</script>`,
      ),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Test server did not bind to TCP');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close(): Promise<void> {
      server.close();
      await once(server, 'close');
    },
  };
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}
