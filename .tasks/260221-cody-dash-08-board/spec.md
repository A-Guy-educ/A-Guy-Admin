# TASK-08: Kanban Board UI Components

## Summary
Create the kanban board UI with KanbanBoard, KanbanColumn, and KanbanCard components. Wire to API for data fetching.

## Task Type
implement_feature

## Dependencies
- TASK-07 (layout/page), TASK-09 (badges), TASK-06 (API routes)

## Requirements

### R1: KanbanBoard component
- File: `src/ui/admin/CodyBoard/KanbanBoard.tsx`
- Client component
- Horizontal flex layout (`flex gap-4 overflow-x-auto`)
- Receives `tasks: CodyTask[]` and `visibleColumns: ColumnId[]`
- Renders one KanbanColumn per visible column
- Groups tasks using `organizeBoard()` from board-mapper

### R2: KanbanColumn component
- File: `src/ui/admin/CodyBoard/KanbanColumn.tsx`
- Props: `column: ColumnDef`, `tasks: CodyTask[]`, `onTaskSelect: (task: CodyTask) => void`
- Vertical card list with sticky header
- Header shows column label + task count badge
- Column background uses color from ColumnDef
- Min-width: `min-w-[280px]`, max-height: scrollable

### R3: KanbanCard component
- File: `src/ui/admin/CodyBoard/KanbanCard.tsx`
- Props: `task: CodyTask`, `onClick: () => void`, `isSelected: boolean`
- Shows: issue title (truncated), task ID (if exists), stage progress icons (from latest running-status comment), risk badge, task type badge, Vercel preview link (🔗 icon if previewUrl exists, opens in new tab)
- Click handler sets selected task
- Selected state: blue border highlight
- Use Card component from `@/ui/web/components/card`

### R4: Wire to CodyDashboard
- Update `src/ui/admin/CodyDashboard/index.tsx`
- Fetch tasks from `/api/cody/tasks` using `fetch()` + `useState`/`useEffect`
- Pass to KanbanBoard
- Track `selectedTask` state
- Show basic loading state while fetching

### R5: Stage progress icons on cards
- Extract from the task's latest `running-status` comment
- Show inline: `✅✅🔄⏳⏳` (compact, no labels)
- If no running status comment, show nothing

## Files to Create/Modify
- `src/ui/admin/CodyBoard/KanbanBoard.tsx` (NEW)
- `src/ui/admin/CodyBoard/KanbanColumn.tsx` (NEW)
- `src/ui/admin/CodyBoard/KanbanCard.tsx` (NEW)
- `src/ui/admin/CodyDashboard/index.tsx` (MODIFIED — add board)

## Acceptance Criteria
- [ ] `/cody` shows kanban board with columns
- [ ] Tasks fetched from API appear in correct columns
- [ ] Clicking a card highlights it (selected state)
- [ ] Stage progress icons show on cards with running pipelines
- [ ] Columns scroll vertically if many cards
- [ ] Board scrolls horizontally if many columns
- [ ] `pnpm tsc --noEmit` passes
- [ ] Uses Tailwind classes only (no SCSS)

## Notes
- Reuse Card from `src/ui/web/components/card.tsx`
- Reuse Badge from `src/ui/web/components/badge.tsx`
- Use `cn()` from `@/infra/utils/ui` for conditional classes
- No drag-and-drop (V2)
