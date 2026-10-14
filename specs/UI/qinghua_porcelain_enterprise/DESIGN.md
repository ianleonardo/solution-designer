---
name: Qinghua Porcelain Enterprise
colors:
  surface: '#0a122a'
  surface-dim: '#0a122a'
  surface-bright: '#313852'
  surface-container-lowest: '#050d25'
  surface-container-low: '#131a33'
  surface-container: '#171e37'
  surface-container-high: '#212942'
  surface-container-highest: '#2c344d'
  on-surface: '#dbe1ff'
  on-surface-variant: '#c3c6d2'
  inverse-surface: '#dbe1ff'
  inverse-on-surface: '#282f49'
  outline: '#8d909b'
  outline-variant: '#434750'
  surface-tint: '#aac7ff'
  primary: '#aac7ff'
  on-primary: '#002f64'
  primary-container: '#1a4b8c'
  on-primary-container: '#99bdff'
  inverse-primary: '#325ea0'
  secondary: '#b4c5ff'
  on-secondary: '#002a78'
  secondary-container: '#0053db'
  on-secondary-container: '#cdd7ff'
  tertiary: '#b7c9d5'
  on-tertiary: '#22333c'
  tertiary-container: '#3d4e58'
  on-tertiary-container: '#adbfca'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#aac7ff'
  on-primary-fixed: '#001b3e'
  on-primary-fixed-variant: '#124687'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#d3e5f1'
  tertiary-fixed-dim: '#b7c9d5'
  on-tertiary-fixed: '#0c1e26'
  on-tertiary-fixed-variant: '#384953'
  background: '#0a122a'
  on-background: '#dbe1ff'
  surface-variant: '#2c344d'
  cobalt-deep: '#103B75'
  cobalt-ultramarine: '#2563EB'
  porcelain-pure: '#FFFFFF'
  porcelain-glaze: '#FAFCFF'
  porcelain-ivory: '#F0F4F8'
  slate-night: '#1C2541'
  slate-midnight: '#0E1626'
  celadon-mist: '#BAE6FD'
  cinnabar-alert: '#DC2626'
  ceramic-gold: '#D97706'
typography:
  display-hero:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.03em
  display-hero-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: '0'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: '0'
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: '0'
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system translates the timeless precision and poise of Qinghua porcelain (Chinese imperial blue-and-white ceramics) into an enterprise-grade AI architecture environment. The aesthetic balances historic artisanship—defined by pure cobalt pigment, luminous porcelain vitrification, and hairline brush control—with modern data density and mission-critical developer workflows.

The system addresses architects, principal engineers, enterprise makers, and compliance checkers navigating automated Solution Design Document (SDD) synthesis, RAG retrieval graphs, and DuckDB schemas. The UI evokes clinical clarity, structural authority, and refined calm: eliminating the chaotic visual noise typical of complex AI workspaces while providing unmistakable precision.

The visual style is **Tactile Minimalist Modern with Ceramic Vitrification**. It pairs crisp architectural geometry with translucent glaze surfaces, razor-sharp cobalt hairline borders, and calibrated ceramic pigments. The interface defaults to a deep kiln-indigo dark mode (representing fired cobalt under dark reduction glazes), while preserving a luminous, translucent porcelain white mode for reading and executive document review.

## Colors

The color palette grounds itself in historical blue-and-white glaze mineral chemistry:

- **Primary Cobalt (`#1A4B8C`) & Deep Cobalt (`#103B75`):** Represents rich cobalt oxide ink. Used for primary interactive actions, selected navigation items, primary container focus strokes, and document layout headers.
- **Secondary Cobalt Ultramarine (`#2563EB`):** High-energy electric ultramarine reserved for interactive link states, active generation progress meters, Mermaid diagram focus flows, and primary AI synthesis highlights.
- **Tertiary Celadon Glaze (`#E0F2FE`) & Celadon Mist (`#BAE6FD`):** The cool, mineral-water wash of celadon glaze. Used for subtle icon accents, badge backgrounds, and secondary focus halos.
- **Neutral Surface Hierarchy:**
  - Dark Mode: Surface floor `slate-midnight` (`#0E1626`), primary canvas `neutral_color_hex` (`#0B132B`), card elevation `slate-night` (`#1C2541`), and border lines (`#253556`).
  - Light Mode: Surface floor `porcelain-pure` (`#FFFFFF`), glaze overlay `porcelain-glaze` (`#FAFCFF`), and container fill `porcelain-ivory` (`#F0F4F8`).
- **Semantic Accents:**
  - **Cinnabar Alert (`#DC2626`):** Inspired by imperial cinnabar seal ink. Strictly reserved for validation failures, missing mandatory architectural requirements (e.g., absent NFR volumetric projections), and destructive actions.
  - **Ceramic Gold (`#D97706`):** Inspired by gold kintsugi joinery. Applied to pending approvals, intermediate LLM generation states, and warning banners.

## Typography

Typography establishes an intentional contrast between architectural clarity and technical documentation precision:

- **Display & Section Headings (`Plus Jakarta Sans`):** Smooth, geometry-driven structural clarity reminiscent of porcelain forms. It delivers strong visual priority without appearing industrial or clumsy.
- **Body & Prose Copy (`Inter`):** Neutral, hyper-legible, optimized for prolonged reading in documentation drafting, WYSIWYG editing, and requirements review. All numeric glyphs default to `tnum` (tabular figures) for data stability.
- **Code, Variables & System Labels (`JetBrains Mono`):** Applied to database entities, DuckDB schemas, RAG inventory IDs, prompt temperature meters, and token counters. Provides technical discipline and precise horizontal alignment across dense matrices.

## Layout & Spacing

The layout utilizes a structured multi-pane viewport designed for dense enterprise authoring:

- **The Workbench Grid:**
  - **Left Rail (Navigation / Section Index):** Fixed width of 280px. Collapsible to 64px icon-only rail on screens below 1280px.
  - **Center Canvas (Synthesis & WYSIWYG Workspace):** Fluid dynamic container expanding across the viewport, constrained to an inner readable line-length maximum of 920px for pure document writing.
  - **Right Flyout (Admin Tuning / RAG Inspector / Chat):** Fixed 380px contextual panel that overlays on small displays and docks flush on monitors exceeding 1440px.
- **Responsive Adaptations:**
  - **Desktop (1280px+):** Full 3-pane synchronous layout. Multi-column DuckDB data grids maintain horizontal scrolling within fixed panes.
  - **Tablet (768px - 1279px):** 2-pane mode. The outline shifts to a top off-canvas drawer; center document canvas dominates; inspector opens as a modal panel.
  - **Mobile (< 768px):** Single vertical stack with bottom navigation bar. Data grids convert to stacked entity cards.
- **Internal Spacing Tokens:**
  - All internal padding follows standard multiples of 4px.
  - Compact gaps (`space-xs`, `space-sm`) are strictly enforced within data tables and prompt tuning controls to ensure high density.
  - Roomier spacing (`space-lg`, `space-xl`) isolates document section blocks to evoke the open negative space of Song and Ming porcelain compositions.

## Elevation & Depth

Depth mimics the vitrified layered glaze (*you*) of fine porcelain rather than heavy physical dropshadows.

- **Vitrified Glaze Tiers:**
  - **Canvas Base (Level 0):** Fired body (`#0B132B` in dark, `#FAFCFF` in light). Ground zero for the document canvas.
  - **Surface Containment (Level 1):** Sub-panels, editor blocks, and data grids sit on `#1C2541` (dark) or `#FFFFFF` (light), bordered by razor 1px borders colored in subtle cobalt-tinged pigment (`rgba(37, 99, 235, 0.16)`).
  - **Overlays & Floating Panels (Level 2):** Flyouts, dynamic suggestion tooltips, and floating chat widgets use backdrop glass filtration: `backdrop-filter: blur(12px)` over `rgba(28, 37, 65, 0.85)` with a 1px celadon rim light border (`rgba(224, 242, 254, 0.2)`).
- **Ceramic Glaze Lighting:**
  - Shadows are diffuse, faint, and cold-tinted: `0 8px 32px -4px rgba(11, 19, 43, 0.45)`.
  - In light mode, shadows emulate diffuse daylight on vitreous enamel: `0 4px 20px -2px rgba(26, 75, 140, 0.08)`.
  - No blunt pure black shadows are allowed; all elevations carry cobalt-indigo refraction.

## Shapes

The shape system adopts **Level 1 (Soft)**:

- Precision and craftsmanship demand controlled, slight contours rather than bulbous, juvenile curves.
- Standard interactive elements (buttons, inputs, dropdown triggers, and table cells) carry a `0.25rem` (4px) corner radius.
- Cards, prompt containers, and modal dialogs use `rounded-lg` (`0.5rem` / 8px).
- Status pills, RAG taxonomy indicators, and role badges leverage full pill contours (`9999px`) to create clear differentiation against structured square data grids.

## Components

### Buttons
- **Primary Action (Synthesize, Export, Approve):** Solid cobalt fill (`#1A4B8C` to `#103B75` hover), crisp 1px glaze border (`#2563EB`), text in pure porcelain white (`#FFFFFF`). Subtle inner shadow rim for glaze luster.
- **Secondary (Inspect, Edit Prompt):** Transparent porcelain body, hairline border (`rgba(37, 99, 235, 0.35)`), text in `#E0F2FE` (dark) or `#1A4B8C` (light). Hover triggers a celadon mist tint.
- **Destructive (Delete Project, Purge Cache):** Transparent fill, 1px cinnabar border (`#DC2626`), text `#DC2626`. On hover, fills with 10% alpha cinnabar.

### Chips & Taxonomy Badges
- **RBAC Role Badges:** Micro-sized (`label-sm`), high-density.
  - *Admin:* Ceramic gold border with gold-tinted fill.
  - *Checker:* Ultramarine blue with deep indigo fill.
  - *Maker:* Celadon tinted tag.
  - *Viewer:* Muted slate neutral tag.
- **Missing Information Alert Chips:** High-visibility cinnabar outline with warning glyph indicating unfulfilled mandatory sections (e.g., missing NFR volumetric data).

### Data Grids (DuckDB Schema & Inventory)
- Engineered with razor 1px borders (`#253556`).
- Header rows feature uppercase `label-sm` in muted glaze slate with subtle background shading.
- Cells support inline editing: on click, cell displays an active 1px cobalt ring without shifting cell height or width.
- Alternating subtle zebra striping (`#0E1626` / `#111C38`) to maintain scanability across 10+ columns.

### Form Inputs & Prompt Tuning Sliders
- **Text & Prompt Fields:** Surface background inset (`#0E1626`), crisp 1px hairline border (`#1C2541`). Focused state ignites a sharp `#2563EB` border with a 2px outer glow in `#E0F2FE` at 15% opacity.
- **Slider Track (Temperature, Max Words):** 2px hairline celadon line with a 12px circular ceramic cobalt thumb featuring a centered white porcelain core.

### Visual Diagram Workspace (Mermaid.js Container)
- Ceramic blueprint background: deep indigo floor overlayed with an ultra-fine dotted grid (`rgba(224, 242, 254, 0.08)` at 16px intervals).
- Floating canvas toolbar providing zoom, center, toggle raw Mermaid code, and sequence flow node editing.

### Global Chat Widget
- Docks persistently to the lower right screen corner.
- Collapsed state displays a circular porcelain disc with a cobalt glazed icon.
- Expanded state features a 420px glassmorphic drawer containing guarded contextual RAG interactions, streaming responses in real time with subtle blue pulse indicators.