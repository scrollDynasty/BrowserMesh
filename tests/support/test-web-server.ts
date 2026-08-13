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
    if (url.pathname === '/waits') {
      response.end(
        page(
          'Wait conditions',
          `<div data-testid="delayed" style="display:none">Delayed visible</div>
          <div data-testid="removed">Remove me</div>
          <div data-testid="hidden-later">Hide me</div>
          <button data-testid="toggle" disabled>Toggle</button>
          <button data-testid="disabled" disabled>Disabled</button>
          <div data-testid="text"></div>
          <script>
            setTimeout(() => {
              document.querySelector('[data-testid=delayed]').style.display = 'block';
              document.querySelector('[data-testid=toggle]').disabled = false;
              document.querySelector('[data-testid=text]').textContent = 'Case-Sensitive Ready';
            }, 50);
            setTimeout(() => {
              document.querySelector('[data-testid=removed]').remove();
              document.querySelector('[data-testid=hidden-later]').style.display = 'none';
            }, 100);
          </script>`,
        ),
      );
      return;
    }
    if (url.pathname === '/action-waits') {
      response.end(
        page(
          'Action waits',
          `<button data-testid="navigate" onclick="location.href='/action-destination'">Navigate</button>
          <button data-testid="request" onclick="fetch('/api/result?token=top-secret')">Request</button>`,
        ),
      );
      return;
    }
    if (url.pathname === '/popup-dialog-actions') {
      response.end(
        page(
          'Popup and dialog actions',
          `<button data-testid="popup" onclick="window.open('/popup-destination', '_blank')">Popup</button>
          <button data-testid="prompt" onclick="document.querySelector('[data-testid=status]').textContent=prompt('Prompt message', 'seed') ?? 'dismissed'">Prompt</button>
          <button data-testid="confirm" onclick="document.querySelector('[data-testid=status]').textContent=confirm('Confirm message') ? 'accepted' : 'dismissed'">Confirm</button>
          <button data-testid="alert" onclick="alert('Alert message'); document.querySelector('[data-testid=status]').textContent='handled'">Alert</button>
          <div data-testid="status">ready</div>`,
        ),
      );
      return;
    }
    if (url.pathname === '/popup-destination') {
      response.end(
        page(
          'Popup destination',
          '<div data-testid="status">popup-ready</div><button data-testid="popup-button">Popup button</button>',
        ),
      );
      return;
    }
    if (url.pathname === '/action-destination') {
      response.end(page('Action destination', '<div data-testid="status">arrived</div>'));
      return;
    }
    if (url.pathname === '/api/result') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
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
    if (url.pathname === '/password') {
      response.end(
        page(
          'Password',
          '<label>Password <input type="password" aria-label="Password" /></label><label>Confirm password <input type="password" aria-label="Confirm password" /></label>',
        ),
      );
      return;
    }
    if (url.pathname === '/ambiguous') {
      response.end(
        page(
          'Ambiguous',
          '<a href="/exact">Employees</a><a href="/overview">Employees overview</a>',
        ),
      );
      return;
    }
    if (url.pathname === '/interactions') {
      response.end(
        page(
          'Typed interactions',
          `<div data-testid="status">ready</div>
          <button data-testid="hover" onmouseenter="document.querySelector('[data-testid=status]').textContent='hovered'">Hover target</button>
          <input aria-label="Focus target" onfocus="document.querySelector('[data-testid=status]').textContent='focused'" />
          <label><input type="checkbox" aria-label="Enabled" onchange="document.querySelector('[data-testid=status]').textContent=this.checked?'checked':'unchecked'" /> Enabled</label>
          <button data-testid="double" ondblclick="document.querySelector('[data-testid=status]').textContent='double-clicked'">Double target</button>
          <div data-testid="drag-source" draggable="true">Drag source</div>
          <div data-testid="drop-target" ondragover="event.preventDefault()" ondrop="event.preventDefault(); document.querySelector('[data-testid=status]').textContent='dropped'">Drop target</div>
          <div style="height:2000px"></div>
          <button data-testid="offscreen">Offscreen target</button>
          <script>
            addEventListener('scroll', () => {
              if (scrollY > 1000) document.querySelector('[data-testid=status]').textContent='scrolled';
            });
          </script>`,
        ),
      );
      return;
    }
    if (url.pathname === '/element-refs') {
      response.end(
        page(
          'Element refs',
          `<input aria-label="Ref input" />
          <button data-testid="replace" onclick="this.outerHTML='<button data-testid=replace>Replacement</button>'">Replace me</button>
          <div data-testid="status">ready</div>`,
        ),
      );
      return;
    }
    if (url.pathname === '/iframes') {
      response.end(
        page(
          'Iframe targeting',
          `<button data-testid="detach-frame" onclick="document.querySelector('[data-testid=outer-frame]').remove()">Detach frame</button>
          <button data-testid="navigate-frame" onclick="document.querySelector('[data-testid=outer-frame]').src='/iframe-replaced'">Navigate frame</button>
          <iframe data-testid="outer-frame" title="Workspace" src="/iframe-level-one"></iframe>
          <iframe data-testid="duplicate-frame" title="Duplicate" src="/iframe-empty"></iframe>
          <iframe data-testid="duplicate-frame" title="Duplicate" src="/iframe-empty"></iframe>`,
        ),
      );
      return;
    }
    if (url.pathname === '/iframe-level-one') {
      const port = request.headers.host?.split(':').at(-1) ?? '';
      response.end(
        page(
          'Iframe level one',
          `<label>Frame input <input aria-label="Frame input" /></label>
          <button data-testid="frame-action" onclick="document.querySelector('[data-testid=frame-status]').textContent='frame-clicked'">Frame action</button>
          <div data-testid="frame-status">frame-ready</div>
          <iframe data-testid="nested-frame" title="Nested workspace" src="http://localhost:${escapeHtml(port)}/iframe-level-two"></iframe>`,
        ),
      );
      return;
    }
    if (url.pathname === '/iframe-level-two') {
      response.end(
        page(
          'Iframe level two',
          `<button data-testid="nested-action" onclick="document.querySelector('[data-testid=nested-status]').textContent='nested-clicked'">Nested action</button>
          <div data-testid="nested-status">nested-ready</div>`,
        ),
      );
      return;
    }
    if (url.pathname === '/iframe-replaced') {
      response.end(page('Replaced iframe', '<div data-testid="replacement">replaced</div>'));
      return;
    }
    if (url.pathname === '/iframe-empty') {
      response.end(page('Empty iframe', '<div>empty</div>'));
      return;
    }
    if (url.pathname === '/observability') {
      response.end(
        page(
          'Observability',
          '<script>console.warn("token=browser-secret warning"); throw new Error("password=page-secret exploded")</script>',
        ),
      );
      return;
    }
    if (url.pathname === '/context-settings') {
      response.end(
        page(
          'Context settings',
          `<div data-testid="context"></div><script>
            const values = [
              innerWidth,
              innerHeight,
              devicePixelRatio,
              navigator.language,
              Intl.DateTimeFormat().resolvedOptions().timeZone,
              matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
              matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference',
              navigator.userAgent
            ];
            document.querySelector('[data-testid=context]').textContent = values.join('|');
          </script>`,
        ),
      );
      return;
    }
    if (url.pathname === '/geolocation') {
      response.end(
        page(
          'Geolocation settings',
          `<div data-testid="geolocation">pending</div><script>
            navigator.permissions.query({ name: 'geolocation' }).then(({ state }) => {
              if (state !== 'granted') {
                document.querySelector('[data-testid=geolocation]').textContent = state;
                return;
              }
              navigator.geolocation.getCurrentPosition(
                ({ coords }) => document.querySelector('[data-testid=geolocation]').textContent =
                  [state, coords.latitude, coords.longitude, coords.accuracy].join('|'),
                ({ code }) => document.querySelector('[data-testid=geolocation]').textContent =
                  'error|' + code,
                { timeout: 1000 }
              );
            });
          </script>`,
        ),
      );
      return;
    }
    if (url.pathname === '/network-observability') {
      response.end(
        page(
          'Network observability',
          `<div data-testid="network-ready">pending</div><script>
            Promise.allSettled([
              fetch('/api/server-error?%74oken=encoded-secret&safe=visible#private-fragment'),
              fetch('/api/duplicate?client_secret=first-secret'),
              fetch('/api/duplicate?client_secret=second-secret'),
              fetch('http://127.0.0.1:1/unreachable?password=transport-secret')
            ]).then(() => document.querySelector('[data-testid=network-ready]').textContent = 'ready');
          </script>`,
        ),
      );
      return;
    }
    if (url.pathname === '/api/server-error') {
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ secret: 'response-body-must-not-be-captured' }));
      return;
    }
    if (url.pathname === '/api/duplicate') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ secret: 'duplicate-body-must-not-be-captured' }));
      return;
    }
    if (url.pathname === '/exact') {
      response.end(page('Exact', '<div data-testid="status">exact</div>'));
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
