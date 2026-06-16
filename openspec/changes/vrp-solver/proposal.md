# Proposal: VRP Daily Route Optimizer

## Intent
Build a complete Next.js application that solves a multi-trip Vehicle Routing Problem (VRP) with daily constraints. A single user starts from home each day, visits a group of locations, returns home, and repeats on subsequent days with the remaining locations.

## Scope
- Single-page web application with file upload, configuration panel, results view, and interactive map
- Client-side .ods file parsing
- Server-side heuristic VRP solver (Clarke & Wright Savings / Greedy Cluster-First)
- Interactive map visualization with per-day colored routes
- Automated deployment to Vercel

## Key Requirements
1. Upload .ods file with "Nombre", "Latitud", "Longitud" columns
2. Configure home coordinates and daily constraint (max hours, max visits, or max capacity)
3. Run optimization to group locations into daily routes
4. Display results: per-day ordered stops + interactive map with polylines
5. Each route starts and ends at home, respects the daily constraint

## Non-goals
- Real-time vehicle tracking
- Multi-depot support
- Time windows (VRPTW)
- User authentication / multi-tenant
- Persistence of results
