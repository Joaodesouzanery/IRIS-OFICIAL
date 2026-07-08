---
name: frontend-patterns
description: Frontend development patterns for React, Next.js, state management, performance, and UI best practices.
metadata:
  origin: ECC
---

# Frontend Patterns

For deep React hook/RSC rules use `react-patterns`. IRIS stack: Next.js 15 App Router + React 18 +
**TanStack React Query** (server-state) + **Zustand** (local) + Tailwind + Radix + Recharts/D3.

## Data fetching (IRIS)
- Use **React Query** for server data: `useQuery({ queryKey, queryFn: () => api.get(...) })` and
  `useMutation` for writes; invalidate related `queryKey`s in `onSuccess`. Don't hand-roll
  `useEffect`+`fetch` for app data (race conditions, no cache/retry).
- The HTTP client is `src/lib/api.ts` (`api.get/post`, throws `ApiError`, normalizes `{error}`).
- Long server jobs: the mutation can loop rounds until `{parcial:false}` and surface per-round
  progress (see the votos-diretores backfill button as the reference pattern).

## Components & state
- Composition over inheritance; derive during render (no derived state in `useEffect`).
- State location: local `useState` → lift to common ancestor → React Query for server data →
  Zustand only for genuinely shared client state. Resist premature global stores/context.
- Radix primitives for dialogs/dropdowns/tabs; `lucide-react` icons; `cn()` (clsx+tailwind-merge)
  for class composition.

## Performance
- Memoize only what a profiler/dep-chain proves matters (`useMemo`/`useCallback`/`React.memo`).
- Stable `key` (id, not index). Virtualize very long lists.

## Accessibility
Semantic HTML first; keyboard reachable; labels on inputs; manage focus on modal/route changes.
