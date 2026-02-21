# TASK-20: Loading States, Empty States, Error Handling

## Summary
Add loading skeletons, empty state messages, and error handling across all dashboard components.

## Task Type
implement_feature

## Dependencies
- TASK-08 (board), TASK-13 (detail), TASK-16 (chat)

## Requirements

### R1: Loading skeletons
- KanbanBoard: Show 3 skeleton columns with 2-3 skeleton cards each while loading
- TaskDetail: Show skeleton layout while pipeline fetches
- BoardSwitcher: Show skeleton tabs while boards load
- Use Skeleton component from `src/ui/web/shared/Skeleton.tsx` if it exists, or create simple Tailwind pulse animations

### R2: Empty states
- KanbanColumn with 0 tasks: Show "No tasks" text in muted color
- Board with 0 issues: Show "No issues found. Create one to get started." with link to create
- No pipeline data: Show "No pipeline data available" in TaskDetail
- No boards: Show only "All" tab

### R3: Error handling
- API errors: Show toast notification (use Toaster from `src/ui/web/components/toaster.tsx`)
- Rate limit (429): Toast with "GitHub API rate limit reached. Retrying in 60s."
- Token expired (502): Banner at top "GitHub token expired. Check GH_TOKEN."
- Network error: Toast with "Network error. Check your connection."
- Missing GH_TOKEN: Show setup instructions instead of board

### R4: Error boundaries
- Wrap CodyDashboard in error boundary
- Show fallback UI with "Something went wrong" + retry button

## Files to Modify
- `src/ui/admin/CodyBoard/KanbanBoard.tsx` (MODIFIED)
- `src/ui/admin/CodyBoard/KanbanColumn.tsx` (MODIFIED)
- `src/ui/admin/CodyBoard/BoardSwitcher.tsx` (MODIFIED)
- `src/ui/admin/CodyTasks/TaskDetail.tsx` (MODIFIED)
- `src/ui/admin/CodyDashboard/index.tsx` (MODIFIED)

## Acceptance Criteria
- [ ] Loading states show while data fetches
- [ ] Empty columns show appropriate message
- [ ] API errors show toast notifications
- [ ] Token issues show banner
- [ ] Error boundary catches crashes
- [ ] `pnpm tsc --noEmit` passes
