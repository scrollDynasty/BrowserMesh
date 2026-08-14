# Documentation design system

## Design read

BrowserMesh documentation is a technical product surface for developers configuring and operating
an MCP browser runtime. The visual language is restrained engineering editorial: precise,
information-dense, and calm rather than promotional.

This is a redesign overhaul that preserves routes, navigation labels, content meaning, accessible
semantics, GitHub Pages behavior, and the existing VitePress architecture.

## Decisions

- Use Geist for interface and prose, with Geist Mono for code and compact metadata.
- Use warm neutral surfaces with one cobalt accent in both light and dark modes.
- Use an 8px radius, hairline borders, and shadows only where they explain elevation.
- Keep motion to hover and focus feedback at 160ms.
- Prefer whitespace, alignment, and dividers over repeated cards.
- Show real commands and MCP configuration instead of decorative product mockups.
- Keep the BrowserMesh wordmark typographic; do not add a logo.

## Design dials

| Dial                | Value | Consequence                                                                            |
| ------------------- | ----: | -------------------------------------------------------------------------------------- |
| Visual variance     |  5/10 | Familiar documentation grid with one asymmetric hero composition                       |
| Motion intensity    |  2/10 | State feedback only; reduced-motion behavior remains explicit                          |
| Information density |  5/10 | Compact developer content with clear section breaks                                    |
| Asset dependence    |  2/10 | Typography, code, and structure carry the interface                                    |
| Brand fidelity      |  7/10 | Preserve the product voice and technical contracts while replacing the visual language |

## Preserve, improve, remove

- Preserve: information architecture, URLs, real commands, technical claims, dark mode, and search.
- Improve: typography, hierarchy, spacing, responsive behavior, focus states, and color discipline.
- Remove: multicolor capability styling, fake status displays, decorative topology panels, repeated
  calls to action, oversized marketing copy, and dark-section inversion.
