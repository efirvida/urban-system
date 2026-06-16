# Tasks: VRP Daily Route Optimizer

## Task 1: Scaffold Next.js Project
- Create Next.js project with TypeScript + Tailwind + App Router
- Install dependencies: xlsx, maplibre-gl, @maplibre/maplibre-gl-react (or react-map-gl), @types/...
- Set up tsconfig strict mode
- Clean boilerplate (remove default page content)
- Add .gitkeep to openspec dirs
- git init + initial commit

## Task 2: Utility Functions
- `utils/haversine.ts`: Haversine distance calculation
- `utils/routerOptimizer.ts`: Main VRP algorithm (savings, clustering, ordering)
- `utils/parser.ts`: .ods file parsing with xlsx
- `lib/utils.ts`: cn() utility for Tailwind class merging (shadcn-style)

## Task 3: Type Definitions
- Define all TypeScript interfaces in `types/index.ts`
- Location, Config, DayRoute, Stop, OptimizeResponse

## Task 4: API Route
- `app/api/optimize/route.ts`
- POST handler that accepts `{ locations, config }`
- Validates input, calls routerOptimizer, returns result
- Error handling with appropriate status codes

## Task 5: UI Components
- `components/FileUpload.tsx` — drag-and-drop zone + file input, preview table
- `components/ConfigPanel.tsx` — home coordinates + constraint type/value inputs
- `components/ResultsPanel.tsx` — collapsible day cards with stop list
- `components/RouteMap.tsx` — maplibre-gl map with markers and polylines
- `components/OptimizeButton.tsx` — triggers optimization with loading state

## Task 6: Main Page (page.tsx)
- Layout: header, content area with config+upload, results split view
- State management for locations, config, results, loading, errors
- Responsive design: stack on mobile, side-by-side on desktop

## Task 7: Global Styles & Polish
- `app/globals.css` with Tailwind directives + map container styles
- Responsive breakpoints
- Loading skeletons and error states

## Task 8: Verify & Test
- Verify TypeScript compilation: `tsc --noEmit`
- Verify build: `next build`
- Manual verification of all components
