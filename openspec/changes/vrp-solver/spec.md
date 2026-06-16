# Spec: VRP Daily Route Optimizer

## Functional Requirements

### FR1: File Upload
- User can upload a .ods file via drag-and-drop or file picker
- File is parsed client-side using the `xlsx` library
- Expected columns: "Nombre" (string), "Latitud" (number), "Longitud" (number)
- Invalid files show an inline error message
- Successful parse shows a preview table of parsed locations

### FR2: Configuration Panel
- Home coordinates: two number inputs for lat/lng, default empty
- Constraint type selector: "Horas máximas", "Visitas máximas", "Capacidad"
- Constraint value: number input (hours, count, or capacity units)
- Time constraint also needs average speed (default 60 km/h) and fixed visit time (default 30 min)

### FR3: Optimization
- Triggered by "Optimizar Rutas" button
- Sends parsed locations + config to API route `/api/optimize`
- API route runs the heuristic algorithm server-side
- Returns structured result with daily routes

### FR4: Results Display
- Left panel: accordion/collapsible sections for "Día 1", "Día 2", etc.
- Each day shows ordered stops with: sequence number, name, distance from previous stop
- Summary per day: total distance, total time, number of stops

### FR5: Map Visualization
- Right panel: interactive map using maplibre-gl
- Home point marked with a distinct icon (house)
- Each day's route shown with a different color polyline
- Location markers with popup showing name and coordinates
- Map auto-fits bounds to show all routes

## Algorithm Requirements

### AR1: Distance Calculation
- Haversine formula for great-circle distance between lat/lng points
- Distance in kilometers
- Travel time = distance / speed (hours) + fixed visit time per stop

### AR2: Clustering (Greedy Cluster-First Route-Second)
1. Calculate savings for each pair of locations (Clarke & Wright)
2. Sort savings descending
3. Build routes greedily, checking daily constraint before adding each location
4. When constraint is violated, close the current day and start a new one

### AR3: Intra-route ordering
- Within each day's cluster, use Nearest Neighbor heuristic starting from home
- Visit the closest unvisited location until all locations in the cluster are visited
- Return to home

## Technical Requirements

### TR1: Stack
- Next.js 14+ with App Router
- TypeScript strict mode
- Tailwind CSS for styling
- maplibre-gl + react-map-gl for maps
- xlsx for .ods parsing

### TR2: API
- POST `/api/optimize` accepts JSON body
- Returns JSON with `{ days: DayRoute[] }` structure

### TR3: Deployment
- Static-safe API routes
- Compatible with Vercel deployment
