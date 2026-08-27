<script setup lang="ts">
import { onUnmounted, ref } from 'vue';

const mcpConfig = `{
  "mcpServers": {
    "browsermesh": {
      "command": "npx",
      "args": [
        "-y",
        "browsermesh"
      ]
    }
  }
}`;

const setupCommands = [
  {
    id: 'install',
    title: 'Install Chromium',
    command: 'npx -y browsermesh --install-browser',
  },
  {
    id: 'connect',
    title: 'Connect your MCP client',
    command: 'npx -y browsermesh',
  },
  {
    id: 'session',
    title: 'Create a session',
    command: 'browser_session_create',
  },
];

const copiedId = ref<string | null>(null);
let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

function markCopied(id: string): void {
  copiedId.value = id;
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    copiedId.value = null;
  }, 1800);
}

onUnmounted(() => clearTimeout(copyResetTimer));

const guarantees = [
  {
    title: 'Separate identities',
    copy: 'Every ready session owns a non-persistent Chromium context with its own cookies, storage, and pages.',
    code: '1 session = 1 BrowserContext',
  },
  {
    title: 'Explicit targets',
    copy: 'Page operations name both identifiers. A page reference from another session is rejected.',
    code: '{ sessionId, pageId }',
  },
  {
    title: 'Predictable ordering',
    copy: 'Operations serialize inside one session while independent sessions continue in parallel.',
    code: 'queue[sessionId]',
  },
  {
    title: 'Bounded results',
    copy: 'Snapshots, text, screenshots, and observations report the limits applied to their output.',
    code: 'structured + bounded',
  },
];
</script>

<template>
  <main class="bm-home">
    <section class="bm-hero">
      <div class="bm-hero-copy">
        <h1>Isolated browser sessions for MCP clients.</h1>
        <p class="bm-lead">
          Run independent Chromium contexts with explicit targets, deterministic ordering, and no
          shared current page.
        </p>
        <div class="bm-actions">
          <a class="bm-button primary" href="./guide/getting-started">Get started</a>
          <a class="bm-text-link" href="./reference/tools">Explore 38 MCP tools</a>
        </div>
      </div>

      <div class="bm-config language-json" role="group" aria-label="MCP configuration">
        <button
          type="button"
          class="copy"
          :aria-label="copiedId === 'config' ? 'Configuration copied' : 'Copy MCP configuration'"
          aria-live="polite"
          @click="markCopied('config')"
        >
          {{ copiedId === 'config' ? 'Copied' : 'Copy' }}
        </button>
        <span class="lang">stdio</span>
        <pre><code>{{ mcpConfig }}</code></pre>
        <div class="bm-config-title">MCP configuration</div>
      </div>
    </section>

    <dl class="bm-facts" aria-label="Runtime facts">
      <div>
        <dt>Transport</dt>
        <dd>MCP stdio</dd>
      </div>
      <div>
        <dt>Browser engine</dt>
        <dd>Chromium</dd>
      </div>
      <div>
        <dt>Runtime</dt>
        <dd>Local Node.js 22+</dd>
      </div>
    </dl>

    <section class="bm-boundary">
      <div>
        <p class="bm-kicker">Clear responsibility boundary</p>
        <h2>The client reasons.<br />BrowserMesh executes.</h2>
      </div>
      <div class="bm-boundary-copy">
        <p>
          Your AI client plans the workflow and chooses tools. BrowserMesh manages browser
          lifecycle, isolation, operation order, persistence, limits, and cleanup.
        </p>
        <a class="bm-text-link" href="./architecture/overview">Read the architecture</a>
      </div>
    </section>

    <section class="bm-guarantees">
      <header>
        <h2>Runtime guarantees</h2>
        <p>Contracts an MCP client can rely on during every browser workflow.</p>
      </header>
      <div class="bm-guarantee-list">
        <article v-for="item in guarantees" :key="item.title">
          <h3>{{ item.title }}</h3>
          <p>{{ item.copy }}</p>
          <code>{{ item.code }}</code>
        </article>
      </div>
    </section>

    <section class="bm-setup">
      <div class="bm-setup-intro">
        <p class="bm-kicker">First connection</p>
        <h2>From install to an isolated session.</h2>
        <p>BrowserMesh stays local. No hosted control plane or separate backend is required.</p>
        <a class="bm-text-link" href="./guide/getting-started">Open the setup guide</a>
      </div>
      <ol class="bm-setup-list">
        <li v-for="item in setupCommands" :key="item.id">
          <strong>{{ item.title }}</strong>
          <div class="bm-command language-bash">
            <button
              type="button"
              class="copy"
              :aria-label="
                copiedId === item.id ? `${item.title} command copied` : `Copy ${item.title} command`
              "
              aria-live="polite"
              @click="markCopied(item.id)"
            >
              {{ copiedId === item.id ? 'Copied' : 'Copy' }}
            </button>
            <span class="lang">bash</span>
            <pre><code>{{ item.command }}</code></pre>
          </div>
        </li>
      </ol>
    </section>

    <nav class="bm-next" aria-label="Continue reading">
      <span>Continue reading</span>
      <a href="./concepts/sessions">Sessions and pages</a>
      <a href="./examples/multi-session">Multi-session example</a>
      <a href="https://github.com/scrollDynasty/BrowserMesh">GitHub repository</a>
    </nav>
  </main>
</template>
