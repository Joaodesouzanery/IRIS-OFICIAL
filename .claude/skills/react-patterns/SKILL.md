---
name: react-patterns
description: React 18/19 patterns — hooks discipline, server/client boundaries, Suspense + error boundaries, data fetching, state decisions, and accessible composition. Use when writing or reviewing React components.
metadata:
  origin: ECC
---

# React Patterns (React 18, Next.js 15 App Router)

## Core
- Render is a pure function of props/state — **derive during render**, don't store derived state in
  `useEffect`.
- Side effects (network, subscriptions, mutations) live in event handlers or `useEffect`, never in
  the render body.
- Composition over inheritance (`children`, slots, compound components).

## Hooks discipline
- Top-level only, never conditional. Clean up every subscription/interval/listener.
- Functional updater when new state depends on old (`setX(prev => ...)`).
- Don't memoize by default — add `useMemo`/`useCallback` only when measured or a dep-chain requires it.
- Extract a custom hook only when the same sequence repeats in 2+ components.

## Server / Client components (App Router)
- Server Components are the default (async, no client JS). Opt into client with `"use client"`.
- Pass serializable props Server→Client; never `import` a Server Component into a Client file — compose
  via `children`.
- IRIS dashboard pages are largely client components using React Query; keep data-fetching in hooks.

## Suspense + Error Boundaries
- Place Suspense near the data; Error Boundary catches render/lifecycle errors (NOT event handlers or
  async — handle those explicitly).

## Data fetching
- React Query / RSC fetch over `useEffect`+`fetch`. See `frontend-patterns` for the IRIS `api.ts` +
  React Query conventions.

## Lists & a11y
Stable `key` (id). Semantic HTML; keyboard reachable; labels; focus management on modal/route change.
