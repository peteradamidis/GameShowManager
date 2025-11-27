# TV Game Show Contestant Management System - Design Guidelines

## Design Approach

**Selected Approach:** Modern Design System - Linear/Notion Inspired
**Justification:** Contemporary productivity tools demand refined aesthetics with excellent information density. Linear's precision and Notion's clarity provide the perfect foundation for a data-intensive contestant management system that feels both powerful and approachable.

## Core Design Principles

1. **Contemporary Minimalism:** Clean interfaces with purposeful elements
2. **Information Density:** Maximize data visibility without overwhelming
3. **Refined Interactions:** Subtle, polished micro-interactions
4. **Spatial Intelligence:** Strategic use of whitespace for visual hierarchy

## Typography

**Font Stack:** Inter (primary), SF Mono (tabular data)

- **Page Titles:** 3xl (30px), font-semibold, tracking-tight
- **Section Headers:** 2xl (24px), font-semibold
- **Card Titles:** lg (18px), font-medium
- **Body Text:** sm (14px), font-normal - Primary interface text
- **Labels:** xs (12px), font-medium, uppercase, tracking-wide, text-gray-500
- **Data/Numbers:** base (16px), font-mono - Table cells, statistics
- **Metadata:** xs (12px), font-normal - Timestamps, helper text

## Layout System

**Spacing Strategy:** Tailwind units of 3, 4, 6, 8, 12, 16

- Cards/panels: p-6
- Section spacing: space-y-8
- Component gaps: gap-4
- Dense areas (tables): p-3

**Grid Architecture:**
- Dashboard stats: grid-cols-4 (single-metric cards)
- Main layout: Sidebar (w-64) + Content area (flex-1)
- Seating chart: Custom 7-column grid with gap-1.5
- Responsive: Full-width mobile, multi-column desktop

## Component Library

### Navigation & Structure

**App Header:**
- Height: h-14, backdrop-blur, border-b
- Logo + Navigation pills (rounded-full backgrounds for active states)
- Action buttons right-aligned with subtle spacing (gap-3)

**Sidebar:**
- Full-height, border-r, bg-gray-50/50
- Icon + label menu items, rounded-lg hover states
- Active indicator: Left border accent + background tint
- Collapsible with icon-only state

### Dashboard Elements

**Metric Cards:**
- Minimal design: border, rounded-xl, p-6
- Large number: text-3xl, font-semibold, tabular-nums
- Label: text-xs, uppercase, tracking-wide, text-gray-500
- Trend indicator: Small arrow + percentage change
- No shadows, rely on borders for definition

**Progress Visualizations:**
- Slim progress bars (h-1.5, rounded-full)
- Inline demographic breakdowns with labels
- Block fill-rate indicators (140 seats per day)
- Gender ratio gauge (60-70% target range)

### Data Tables

**Modern Table Design:**
- Borderless rows with hover backgrounds (hover:bg-gray-50)
- Header: text-xs, uppercase, font-medium, pb-3, border-b
- Cell padding: px-4 py-3
- Tight leading for density (leading-tight)
- Sticky header with backdrop-blur
- Alternating rows: subtle striping on hover only
- Selection checkboxes: rounded, indeterminate states

**Columns:** Name, Group Badge, Age, Gender, Status Pill, Record Day, Actions (icon menu)

### Forms & Inputs

**Input Fields:**
- Height: h-10, rounded-lg, border
- Focus: ring-2 with offset, border color change
- Labels positioned above with mb-2
- Helper text below: text-xs, text-gray-500

**Availability Grid:**
- Calendar-style checkbox grid
- Selected dates: filled background, rounded
- Disabled dates: opacity-50

**File Upload:**
- Dashed border zone, rounded-xl, p-8
- Center-aligned upload icon + text
- Drag-over state: border color shift + background tint

### Interactive Seating Chart

**Chart Layout:**
- 7 blocks × 20 rows, ultra-compact spacing (gap-1.5)
- Block headers: Sticky top, text-xs, font-medium, pb-2
- Real-time stats per block: Gender count, age range

**Seat Elements:**
- Compact cards: w-full aspect-square, rounded-md, border
- Content: Initials (large), age (small), gender icon (corner)
- Group affiliation: 3px left border in group color
- Empty seats: Dashed border, muted background
- Drag feedback: Opacity-50 on source, shadow-lg on ghost
- Drop zones: Ring highlight, background pulse

**Bulk Actions Toolbar:**
- Appears on selection, sticky bottom
- Compact height (h-12), backdrop-blur, border-top
- Actions: Auto-assign, Clear, Reset with counts

### Buttons

**Primary:** px-4 py-2, rounded-lg, font-medium, text-sm
**Secondary:** Same size, border variant
**Ghost:** Hover background only, no border
**Icon buttons:** w-8 h-8, rounded-lg, centered icon

### Status System

**Pill Badges:**
- Inline-flex, px-2.5 py-0.5, rounded-full, text-xs, font-medium
- Dot indicator + label
- States: Pending (gray), Available (emerald), Assigned (blue), Invited (violet), Confirmed (green)

### Modals & Panels

**Dialog Overlays:**
- Backdrop: bg-black/20, backdrop-blur-sm
- Content: max-w-2xl, rounded-xl, shadow-2xl
- Padding: p-6, with header/body/footer sections

**Slide-out Panels:**
- Right-aligned, w-96, full-height
- Smooth slide transition (300ms)
- Detail view for contestants with tabbed sections

## Animations

**Refined Micro-interactions:**
- Drag: transform + opacity (200ms ease-out)
- Modal entry: scale-95 to scale-100 + fade (150ms)
- Button press: scale-[0.98] (100ms)
- Table row hover: background transition (150ms)
- NO decorative scroll effects or auto-play

## Accessibility

- WCAG 2.1 AA compliance throughout
- Keyboard shortcuts overlay (⌘K for quick actions)
- Drag-and-drop keyboard alternatives (arrow keys + space)
- Focus-visible rings on all interactive elements
- Adequate touch targets (min 44×44px)
- High contrast status indicators