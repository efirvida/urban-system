# Design: VRP Daily Route Optimizer

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Client (Next.js App Router)                            │
│  ┌──────────┐  ┌──────────────┐  ┌────────┐  ┌──────┐ │
│  │FileUpload│  │ ConfigPanel  │  │Results │  │Route │ │
│  │ (ods)    │  │ (constraints)│  │Panel   │  │Map   │ │
│  └────┬─────┘  └──────┬───────┘  └───┬────┘  └──┬───┘ │
│       │               │              │          │      │
│  ┌────▼───────────────▼──────────────▼──────────▼──┐   │
│  │              page.tsx (orchestrator)             │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │ POST /api/optimize             │
└────────────────────────┼───────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────┐
│  API Route: /api/optimize/route.ts                      │
│  ┌──────────────────────────────────────────────────┐   │
│  │  routerOptimizer.ts                              │   │
│  │  ├── haversineDistance()                         │   │
│  │  ├── calculateSavings()                          │   │
│  │  ├── clusterByDay()                              │   │
│  │  └── orderRoute()                                │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Component Tree

```
Layout (root)
└── Page (client component)
    ├── FileUpload (client)
    │   └── PreviewTable
    ├── ConfigPanel (client)
    │   ├── CoordinateInputs
    │   └── ConstraintSelector
    ├── OptimizeButton
    └── ResultsLayout (split view)
        ├── ResultsPanel (left)
        │   └── DayCard[] (collapsible)
        │       └── StopRow[]
        └── RouteMap (right)
            ├── Map markers (home + locations)
            └── Route polylines (per-day colors)
```

## Data Flow

1. User uploads .ods → parsed with `xlsx.read()` → stored in state as `Location[]`
2. User configures home + constraint → stored in state as `Config`
3. User clicks "Optimizar Rutas" → POST to `/api/optimize` with `{ locations, config }`
4. API route calls `optimizeRoutes(locations, config)` → returns `{ days: DayRoute[] }`
5. Response stored in state → renders ResultsPanel + RouteMap

## Type Definitions

```typescript
interface Location {
  name: string;
  lat: number;
  lng: number;
}

interface Config {
  homeLat: number;
  homeLng: number;
  constraintType: 'hours' | 'visits' | 'capacity';
  constraintValue: number;
  avgSpeed?: number; // km/h, default 60
  visitTime?: number; // minutes, default 30
}

interface DayRoute {
  day: number;
  stops: Stop[];
  totalDistance: number; // km
  totalTime: number; // hours
  totalStops: number;
}

interface Stop {
  sequence: number;
  name: string;
  lat: number;
  lng: number;
  distanceFromPrev: number; // km
  isHome: boolean;
}

interface OptimizeResponse {
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
}
```

## Algorithm: Greedy Cluster-First Route-Second

### Step 1: Savings Calculation (Clarke & Wright)
- For every pair of locations (i, j), calculate savings:
  `s(i,j) = dist(home, i) + dist(home, j) - dist(i, j)`
- Higher savings means more beneficial to visit i and j on the same route

### Step 2: Sort savings descending

### Step 3: Build clusters respecting daily constraint
- Start Day 1 with empty cluster
- For each pair (i, j) from highest savings:
  - Try adding both to current day's cluster
  - Calculate if constraint is satisfied (total hours/visits/capacity)
  - If yes, add to current cluster
  - If no, close current day, start next day

### Step 4: Intra-route ordering (Nearest Neighbor)
- For each day's cluster:
  - Start at home
  - Visit the nearest unvisited location
  - Repeat until all locations in cluster are visited
  - Return to home

## Colors for Routes
- Pre-defined palette for up to 10 days
- Cycle if more days needed

## Map Configuration
- Use maplibre-gl with a free tile style (demotiles or Maptiler free plan)
- Each day route gets a unique color from the palette
- Home marker distinct from location markers
- Fit bounds to show all routes on load
