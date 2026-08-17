import { BrowserMeshError } from '../../domain/errors.js';
import type { ToolName } from './contracts.js';

/**
 * Which tools a server publishes.
 *
 * Discovery is paid once per session, in context, by every client. A client
 * running BrowserMesh alongside several other MCP servers may not have room for
 * the full surface, and a client that only navigates and reads pages should not
 * pay for persistence and observability contracts it will never call.
 *
 * The default publishes every profile, so an existing configuration keeps every
 * tool it had. Narrowing is opt-in through `--tools` / `BROWSERMESH_TOOLS`
 * (ADR 0020).
 */
export const toolProfiles = {
  /** Sessions, pages, navigation, reading, interaction, waits, and capture. */
  core: [
    'browser_runtime_info',
    'browser_session_create',
    'browser_session_list',
    'browser_session_get',
    'browser_session_close',
    'browser_page_create',
    'browser_page_list',
    'browser_page_close',
    'browser_navigate',
    'browser_back',
    'browser_forward',
    'browser_reload',
    'browser_get_url',
    'browser_get_title',
    'browser_snapshot',
    'browser_visible_text',
    'browser_click',
    'browser_double_click',
    'browser_hover',
    'browser_focus',
    'browser_check',
    'browser_uncheck',
    'browser_scroll_into_view',
    'browser_scroll',
    'browser_drag_and_drop',
    'browser_fill',
    'browser_press',
    'browser_select_option',
    'browser_screenshot',
    'browser_wait',
    'browser_action_and_wait',
  ],
  /** Console, page-error, and network evidence recorded for a page. */
  observability: ['browser_observe'],
  /** Saved browser storage state reused by later sessions. */
  persistence: ['browser_state_save', 'browser_state_list', 'browser_state_remove'],
} as const satisfies Record<string, readonly ToolName[]>;

export type ToolProfile = keyof typeof toolProfiles;

export const toolProfileNames = Object.keys(toolProfiles) as readonly ToolProfile[];

/**
 * Resolve a comma-separated selection of profiles into the tools to publish.
 *
 * An empty or absent selection publishes everything. An unknown name fails
 * configuration rather than silently publishing a surface the operator did not
 * ask for.
 */
export function selectedTools(selection: string | undefined): ReadonlySet<ToolName> {
  const requested = (selection ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (requested.length === 0) return new Set(allTools());

  const selected = new Set<ToolName>();
  for (const name of requested) {
    if (!isToolProfile(name))
      throw new BrowserMeshError(
        'INVALID_ARGUMENT',
        `Unknown tool profile '${name}'. Available profiles: ${toolProfileNames.join(', ')}`,
      );
    for (const tool of toolProfiles[name]) selected.add(tool);
  }
  return selected;
}

function allTools(): ToolName[] {
  return toolProfileNames.flatMap((profile) => [...toolProfiles[profile]]);
}

function isToolProfile(value: string): value is ToolProfile {
  return Object.prototype.hasOwnProperty.call(toolProfiles, value);
}
