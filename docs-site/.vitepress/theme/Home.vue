<script setup lang="ts">
const capabilities = [
  {
    label: 'Identity',
    title: 'A context for every role',
    copy: 'Buyer, seller, and admin sessions keep separate cookies, storage, pages, and permission state.',
    code: '1 session → 1 BrowserContext',
    accent: 'blue',
  },
  {
    label: 'Addressing',
    title: 'No invisible current tab',
    copy: 'Every page action names its session and page. A page ID from another session is rejected.',
    code: '{ sessionId, pageId }',
    accent: 'mint',
  },
  {
    label: 'Concurrency',
    title: 'Order within. Parallel across.',
    copy: 'Each session has its own operation queue, so independent workflows can move at the same time.',
    code: 'queue[sessionId]',
    accent: 'coral',
  },
  {
    label: 'Evidence',
    title: 'Useful output, hard bounds',
    copy: 'Snapshots, visible text, screenshots, and observations report truncation and applied limits.',
    code: 'bounded + structured',
    accent: 'violet',
  },
];
</script>

<template>
  <main class="bm-home">
    <section class="bm-hero">
      <div class="bm-hero-copy">
        <p class="bm-product-line"><span>BrowserMesh</span> Documentation</p>
        <h1>Give every browser identity <em>its own lane.</em></h1>
        <p class="bm-lead">
          A local multi-session browser runtime for MCP clients. Explicit targets, isolated Chromium
          contexts, predictable concurrency.
        </p>
        <div class="bm-actions">
          <a class="bm-button primary" href="./guide/getting-started">Start with one session</a>
          <a class="bm-button quiet" href="./reference/tools">Browse all 38 tools</a>
        </div>
        <dl class="bm-facts">
          <div>
            <dt>Transport</dt>
            <dd>MCP stdio</dd>
          </div>
          <div>
            <dt>Browser</dt>
            <dd>Chromium</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>Local Node.js</dd>
          </div>
        </dl>
      </div>

      <div class="bm-map-wrap">
        <div
          class="bm-map"
          aria-label="One MCP client connected to three isolated browser sessions"
        >
          <div class="bm-map-head">
            <span>session topology</span>
            <span class="bm-live"><i></i> runtime ready</span>
          </div>
          <div class="bm-client">
            <span>MCP client</span>
            <small>plans the workflow</small>
          </div>
          <div class="bm-trunk"><span>MCP</span></div>
          <div class="bm-branch" aria-hidden="true"></div>
          <div class="bm-contexts">
            <article class="buyer">
              <header><i></i><span>buyer</span><b>A</b></header>
              <p>BrowserContext</p>
              <small>cookies · storage · pages</small>
            </article>
            <article class="seller">
              <header><i></i><span>seller</span><b>B</b></header>
              <p>BrowserContext</p>
              <small>cookies · storage · pages</small>
            </article>
            <article class="admin">
              <header><i></i><span>admin</span><b>C</b></header>
              <p>BrowserContext</p>
              <small>cookies · storage · pages</small>
            </article>
          </div>
          <p class="bm-map-note">No shared current page. No identity crossover.</p>
        </div>
      </div>
    </section>

    <div class="bm-principles" aria-label="BrowserMesh principles">
      <span>Explicit addresses</span><i></i><span>Context isolation</span><i></i
      ><span>Per-session queues</span><i></i><span>Bounded results</span>
    </div>

    <section class="bm-thesis">
      <div class="bm-section-label">The runtime boundary</div>
      <div>
        <h2>The client decides.<br />BrowserMesh carries it out.</h2>
        <p>
          Reasoning stays in the external AI client. BrowserMesh owns the difficult browser
          mechanics: lifecycle, isolation, ordering, persistence, limits, and cleanup.
        </p>
        <a href="./architecture/overview">See how the layers fit together <span>↗</span></a>
      </div>
    </section>

    <section class="bm-capabilities">
      <div class="bm-cap-head">
        <div class="bm-section-label">What the runtime guarantees</div>
        <p>Behavior the client can rely on, not marketing promises.</p>
      </div>
      <div class="bm-cap-list">
        <article v-for="item in capabilities" :key="item.title" :class="item.accent">
          <span class="bm-cap-label">{{ item.label }}</span>
          <h3>{{ item.title }}</h3>
          <p>{{ item.copy }}</p>
          <code>{{ item.code }}</code>
        </article>
      </div>
    </section>

    <section class="bm-quick">
      <div class="bm-quick-copy">
        <div class="bm-section-label light">First connection</div>
        <h2>Install Chromium.<br />Let your client connect.</h2>
        <p>Node.js 22 or newer. No hosted control plane and no separate backend.</p>
        <a href="./guide/getting-started">Open the complete setup guide <span>→</span></a>
      </div>
      <ol class="bm-terminal">
        <li>
          <span>01</span>
          <div>
            <small>Install the managed browser</small
            ><code>npx -y multi-agent-browser-mcp --install-browser</code>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <small>Configure the stdio command</small><code>npx -y multi-agent-browser-mcp</code>
          </div>
        </li>
        <li>
          <span>03</span>
          <div><small>Create an isolated identity</small><code>browser_session_create</code></div>
        </li>
      </ol>
    </section>

    <section class="bm-workflow">
      <div class="bm-workflow-copy">
        <div class="bm-section-label">Multi-session by design</div>
        <h2>Compare roles without mixing them.</h2>
        <p>
          Place an order as a buyer while the admin session verifies it. Each lane keeps its own
          authentication state and can move independently.
        </p>
      </div>
      <div class="bm-lanes">
        <div class="bm-lane-head">
          <span>workflow</span><span>isolated session</span><span>context</span>
        </div>
        <div class="bm-lane buyer">
          <strong>Place order</strong><span>buyer</span><code>Context A</code>
        </div>
        <div class="bm-lane seller">
          <strong>Prepare order</strong><span>seller</span><code>Context B</code>
        </div>
        <div class="bm-lane admin">
          <strong>Verify order</strong><span>admin</span><code>Context C</code>
        </div>
      </div>
    </section>

    <section class="bm-cta">
      <div>
        <span>Browser runtime for external MCP clients</span>
        <h2>Keep identities separate.<br />Keep every target explicit.</h2>
      </div>
      <div class="bm-actions">
        <a class="bm-button primary" href="./guide/getting-started">Get started</a>
        <a class="bm-button quiet" href="https://github.com/scrollDynasty/multi-agent-browser-mcp"
          >View on GitHub</a
        >
      </div>
    </section>
  </main>
</template>
