# TV Game Show Contestant Management System - Design Guidelines

## Design Approach

**Selected Approach:** Design System - Material Design Inspired
**Justification:** This is a data-intensive productivity tool requiring efficient workflows, clear information hierarchy, and intuitive drag-and-drop interactions. Material Design's elevation system and interactive feedback patterns are ideal for the complex seating chart and dashboard requirements.

## Core Design Principles

1. **Information Clarity:** Prioritize readability and scannable data displays
2. **Workflow Efficiency:** Minimize clicks and cognitive load for repetitive tasks
3. **Visual Feedback:** Provide clear status indicators and interaction feedback
4. **Flexible Control:** Balance automation with manual override capabilities

## Typography

**Font Family:** Inter (Google Fonts) for all interface elements
- **Headings (H1):** 2xl (24px), font-semibold - Dashboard titles, page headers
- **Headings (H2):** xl (20px), font-semibold - Section headers, card titles
- **Headings (H3):** lg (18px), font-medium - Subsections, block headers
- **Body Text:** base (16px), font-normal - Forms, table content, descriptions
- **Labels:** sm (14px), font-medium - Form labels, table headers, status badges
- **Small Text:** xs (12px), font-normal - Helper text, metadata, timestamps

## Layout System

**Spacing Units:** Use Tailwind spacing units of 2, 4, 6, and 8 for consistency
- Component padding: p-4 to p-6
- Section margins: mb-6 to mb-8
- Card spacing: gap-4 to gap-6
- Form element spacing: space-y-4

**Container Widths:**
- Full application wrapper: max-w-7xl with mx-auto
- Dashboard cards: Full width within grid columns
- Forms: max-w-2xl for optimal readability
- Modals: max-w-4xl for seating chart interactions

**Grid Structure:**
- Dashboard overview: 3-column grid (lg:grid-cols-3) for statistics cards
- Main workspace: 2-column layout (sidebar + main content area)
- Seating chart: Custom 7-column grid for blocks with 20 rows each
- Contestant tables: Single column with responsive horizontal scrolling

## Component Library

### Navigation & Layout
**Top Navigation Bar:**
- Fixed header with shadow
- Logo/title left-aligned
- Primary actions right-aligned (Import Data, Send Invitations buttons)
- Height: h-16

**Sidebar Navigation:**
- Width: w-64 on desktop, collapsible on mobile
- Menu items with icons and labels
- Active state highlighting
- Sections: Dashboard, Contestants, Record Days, Seating Chart, Settings

### Dashboard Components
**Statistics Cards:**
- Elevated surface with rounded corners (rounded-lg)
- Large number display (text-4xl, font-bold)
- Label below (text-sm)
- Icon in corner
- Grid layout showing: Total Applicants, Pending Availability, Assigned Contestants, Upcoming Record Days

**Progress Indicators:**
- Horizontal bar charts for demographic breakdowns
- Percentage displays for fill rates (7 blocks × 20 seats = 140 per day)
- Gender balance visualization (target: 60-70% female)

### Data Tables
**Contestant List Table:**
- Sticky header row
- Sortable columns: Name, Group ID, Age, Gender, Availability Status, Record Day Assigned
- Row hover states
- Checkbox selection for bulk actions
- Pagination footer (20 entries per page)
- Search/filter bar above table

**Table Row Structure:**
- Standard row height: h-12
- Alternating row backgrounds for readability
- Group indicators (colored dot or badge) for members of same group

### Forms
**Availability Request Form (sent to contestants):**
- Clean, single-column layout
- Clear section headers
- Checkbox grid for available dates
- Text area for additional notes
- Prominent submit button at bottom

**Import Excel Interface:**
- Drag-and-drop upload zone with dashed border
- File preview table after upload
- Column mapping interface
- "Process & Import" action button

### Interactive Seating Chart
**Chart Structure:**
- 7 vertical blocks side-by-side (grid-cols-7)
- Each block contains 20 seat positions (grid-rows-20)
- Block headers showing: Block number, Gender ratio, Age distribution
- Compact spacing between blocks (gap-2)

**Seat Cards:**
- Small rectangular cards (aspect ratio 3:4)
- Displays: Name (truncated), Age, Gender icon
- Draggable with cursor feedback
- Color-coded borders for groups (same color = same group)
- Empty seats: dashed border, light background
- Hover state: subtle elevation increase

**Drag-and-Drop Interactions:**
- Visual indicators during drag (ghost element, drop zones highlighted)
- Snap-to-grid behavior
- Invalid drop zones shown with visual feedback
- Undo/redo buttons for seating changes

### Buttons & Actions
**Primary Actions:** Large, prominent buttons (px-6, py-3)
- "Auto-Assign Seats" - triggers algorithm
- "Send Invitations" - final approval step
- "Import Data" - upload trigger

**Secondary Actions:** Medium buttons (px-4, py-2)
- "Reset Block," "Clear Selection," "Export"

**Tertiary Actions:** Small text links or icon buttons
- "Edit," "Delete," "View Details"

### Status Badges
**Small pill-shaped indicators:**
- "Pending Availability" - amber
- "Available" - green
- "Assigned" - blue
- "Invited" - purple
- "Confirmed" - dark green

### Modals & Overlays
**Confirmation Dialogs:**
- Centered overlay (max-w-md)
- Clear heading, description, action buttons
- Used for: Send invitations, reset assignments, bulk operations

**Detail Panels:**
- Slide-out from right (max-w-lg)
- Shows full contestant details, group members, availability responses
- Close button in top-right

## Animations

**Minimal, purposeful animations only:**
- Drag-and-drop: Smooth position transitions (transition-transform duration-200)
- Modal/panel entry: Fade + slide (transition-opacity duration-300)
- Button feedback: Subtle scale on click
- NO decorative animations, scroll effects, or auto-playing elements

## Images

**No images required** - This is a pure data management interface focused on functionality over aesthetics. Icons only (using Heroicons via CDN).

## Accessibility

- Maintain WCAG 2.1 AA standards throughout
- Keyboard navigation for all interactive elements (especially drag-and-drop alternatives)
- Clear focus states on all inputs and buttons
- Sufficient contrast ratios for text and interactive elements
- Screen reader labels for icon-only buttons
- Alt text for status indicators