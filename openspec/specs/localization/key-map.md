# Translation Key Map

Complete mapping of every hardcoded Spanish string to its new translation key.

## src/app/layout.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 9 | "Optimizador de Rutas VRP" | metadata.title | Page title |
| 10-11 | "Optimización de rutas diarias multi-trayecto..." | metadata.description | Meta description |
| 20 | lang="es" | — | Dynamic from i18n.language |

## src/app/page.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 150 | "Cargar" | wizard.steps.upload | Step label |
| 151 | "Columnas" | wizard.steps.mapping | Step label |
| 152 | "Revisar" | wizard.steps.review | Step label |
| 153 | "Configurar" | wizard.steps.config | Step label |
| 154 | "Resultados" | wizard.steps.results | Step label |
| 267 | name: "Casa" | routeEditor.home | Home location name |
| 447 | "Error al aplicar el mapeo" | wizard.errors.applyMapping | Error message |
| 473 | "No hay ubicaciones válidas." | wizard.errors.noValidLocations | Error message |
| 477 | "Configura las coordenadas de la casa." | wizard.errors.configureHome | Error message |
| 619 | "No result event in stream" | wizard.errors.noResult | Error message (internal) |
| 669 | "Ningún optimizador pudo resolver..." | wizard.errors.noResult | Long error message |
| 748 | "Error inesperado" | wizard.errors.unexpectedError | Error message |
| 1060 | routingLabel="Rutas optimizadas" | — | Passed as prop, key in consumer |
| 1092 | "Terminar edición (con cambios)" | routeEditor.finishEditingWithChanges | Button text |
| 1093 | "Terminar edición" | routeEditor.finishEditing | Button text |
| 1093 | "Editar rutas" | routeEditor.editRoutes | Button text |
| 1233 | aria-label="Cerrar error" | ariaLabels.closeError | Aria label |

## src/components/FileUpload.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 42 | "No se pudieron detectar automáticamente..." | fileUpload.errors.autoDetectFailed | Error message |
| 50 | "Error al leer el archivo" | fileUpload.errors.readError | Error message |

## src/components/ColumnMapper.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 24 | nameColumn: "Nombre" | columnMapper.defaults.name | Default column name |
| 25 | latColumn: "Latitud" | columnMapper.defaults.lat | Default column name |
| 26 | lngColumn: "Longitud" | columnMapper.defaults.lng | Default column name |
| 211 | "Nombre" | columnMapper.defaults.name | Fallback display |
| 214 | "Lat" | columnMapper.defaults.lat | Short fallback display |
| 217 | "Lng" | columnMapper.defaults.lng | Short fallback display |
| 243 | aria-label="Fila válida" | columnMapper.ariaLabels.validRow | Aria label |

## src/components/DataEditor.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 88 | "Nombre vacío" | dataEditor.errors.emptyName | Validation error |
| 93 | "Latitud inválida" | dataEditor.errors.invalidLat | Validation error |
| 96 | "Latitud fuera de rango" | dataEditor.errors.latOutOfRange | Validation error |
| 105 | "Longitud inválida" | dataEditor.errors.invalidLng | Validation error |
| 108 | "Longitud fuera de rango" | dataEditor.errors.lngOutOfRange | Validation error |
| 160 | placeholder="Buscar por nombre..." | dataEditor.searchPlaceholder | Search placeholder |
| 168 | "Todas" | dataEditor.filters.all | Filter option |
| 169 | "Válidas" | dataEditor.filters.valid | Filter option |
| 170 | "Inválidas" | dataEditor.filters.invalid | Filter option |
| 171 | "Seleccionadas" | dataEditor.filters.selected | Filter option |
| 172 | "No seleccionadas" | dataEditor.filters.unselected | Filter option |
| 240 | "Sin resultados para esa búsqueda" | dataEditor.empty.noResults | Empty state |
| 241 | "No hay filas para mostrar" | dataEditor.empty.noRows | Empty state |
| 269 | placeholder="Sin nombre" | dataEditor.placeholders.noName | Placeholder |
| 306 | aria-label="Fila válida" | dataEditor.ariaLabels.validRow | Aria label |
| 328 | "Selecciona al menos una" | dataEditor.selectionHint | Selection hint |

## src/components/ConfigPanel.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 18 | "Horas máximas por jornada" | configPanel.constraintTypes.hours | Constraint option |
| 19 | "Visitas máximas por jornada" | configPanel.constraintTypes.visits | Constraint option |
| 20 | "Horas + Visitas máximas" | configPanel.constraintTypes.hoursAndVisits | Constraint option |
| 78 | aria-label="Cancelar colocación en mapa" | configPanel.ariaLabels.cancelPlaceHome | Aria label |
| 78 | aria-label="Colocar casa en el mapa" | configPanel.ariaLabels.placeHome | Aria label |
| 147 | aria-label="Disminuir horas" | configPanel.ariaLabels.decreaseHours | Aria label |
| 159 | aria-label="Aumentar horas" | configPanel.ariaLabels.increaseHours | Aria label |
| 173 | aria-label="Disminuir visitas" | configPanel.ariaLabels.decreaseVisits | Aria label |
| 185 | aria-label="Aumentar visitas" | configPanel.ariaLabels.increaseVisits | Aria label |
| 196 | "Jornada laboral" | configPanel.labels.workDay | Constraint label |
| 196 | "Visitas por día" | configPanel.labels.visitsPerDay | Constraint label |
| 202 | aria-label="Disminuir horas" | configPanel.ariaLabels.decreaseHours | Aria label (dynamic) |
| 202 | aria-label="Disminuir visitas" | configPanel.ariaLabels.decreaseVisits | Aria label (dynamic) |
| 214 | aria-label="Aumentar horas" | configPanel.ariaLabels.increaseHours | Aria label (dynamic) |
| 214 | aria-label="Aumentar visitas" | configPanel.ariaLabels.increaseVisits | Aria label (dynamic) |
| 275 | "Carga ubicaciones primero" | configPanel.button.loadLocationsFirst | Button disabled text |

## src/components/ResultsPanel.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 88 | "Algoritmo" | resultsPanel.algorithm | Section header |
| 122 | title="Fiabilidad media: ..." | resultsPanel.averageReliability | Tooltip, uses interpolation |
| 137-141 | "{N} algoritmo no disponible..." | resultsPanel.algorithmsUnavailable | Plural, interpolation |
| 152 | "Resumen Global" | resultsPanel.globalSummary | Section header |
| 159 | "Consenso 3 proveedores" | resultsPanel.consensus | Badge text |
| 166 | "Días" | resultsPanel.days | Stat label |
| 172 | "Ubicaciones" | resultsPanel.locations | Stat label |
| 178 | "Total recorrido" | resultsPanel.totalDistance | Stat label |
| 207 | "{N} paradas" | resultsPanel.stops | Stop count |
| 252 | "{dist} distancia" | resultsPanel.distance | Distance label |
| 253 | "{dur} duración" | resultsPanel.duration | Duration label |
| 254 | "{N} visitas" | resultsPanel.visits | Visit count |
| 264 | title="Ver ruta en Google Maps" | resultsPanel.viewInGoogleMaps | Link title |
| 220-221 | aria-label="Mostrar día..." | resultsPanel.ariaLabels.showDayInMap | Aria label |
| 220-221 | aria-label="Ocultar día..." | resultsPanel.ariaLabels.hideDayInMap | Aria label |
| 304 | "desde parada anterior" | resultsPanel.fromPreviousStop | Distance label |

## src/components/DayColumn.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 51 | "{fmt} / {val}h" | — | Dynamic gauge label |
| 55 | "{count} / {max} visitas" | — | Dynamic gauge label, "visitas" key |
| 65 | "{fmt}h · {count}" | — | Combined gauge label |
| 132 | "Día {day}" | dayColumn.day | Day header |
| 135 | "{N} paradas" | dayColumn.stops | Stop count |
| 147 | aria-label="Mostrar ruta día..." | dayColumn.ariaLabels.showRouteInMap | Aria label |
| 147 | aria-label="Ocultar ruta día..." | dayColumn.ariaLabels.hideRouteInMap | Aria label |
| 243 | "(Día vacío — soltar POIs aquí)" | dayColumn.emptyDay | Empty state |
| 265 | "horas {N}%" | dayColumn.gauge.hours | Gauge label |
| 266 | "visitas {N}%" | dayColumn.gauge.visits | Gauge label |

## src/components/StopItem.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 76 | aria-label="Arrastrar parada" | stopItem.ariaLabels.dragStop | Aria label |
| 99 | title="Casa" | stopItem.home | Title for home |
| 116 | aria-label="Quitar parada" | stopItem.ariaLabels.removeStop | Aria label |

## src/components/Sidebar.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 29 | aria-label="Cerrar panel" | sidebar.ariaLabels.closePanel | Aria label |
| 29 | aria-label="Abrir panel" | sidebar.ariaLabels.openPanel | Aria label |

## src/components/EditorToolbar.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 54 | aria-label="Aplicar cambios al..." | editorToolbar.ariaLabels.applyChanges | Aria label |
| 70 | aria-label="Descartar cambios..." | editorToolbar.ariaLabels.discardChanges | Aria label |
| 86 | aria-label="Deshacer última acción" | editorToolbar.ariaLabels.undoLastAction | Aria label |
| 102 | aria-label="Rehacer acción deshecha" | editorToolbar.ariaLabels.redoAction | Aria label |

## src/components/RouteEditor.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 155 | name: "Casa" | routeEditor.home | Home location name |
| 608 | "Ya está en este día" | routeEditor.alreadyInThisDay | Title text |
| 608 | "Mover a Día {d}" | routeEditor.moveToDay | Title text, interpolation |
| 624 | title="Quitar de la ruta" | routeEditor.removeFromRoute | Title text |

## src/components/OptimizeProgress.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 94 | "Matriz de distancias completa" | optimizeProgress.complete | Status text |
| 94 | "Calculando rutas" | optimizeProgress.calculating | Status text |

## src/components/UnreachableWarning.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 34 | "POIs sin ruta accesible" | unreachableWarning.title | Section header |
| 42-44 | "Estos puntos no pudieron conectarse..." | unreachableWarning.description | Body text |
| 78 | "Reintentando..." | unreachableWarning.retrying | Button loading text |
| 78 | "Reintentar con todos" | unreachableWarning.retry | Button text |
| 89 | "sin camino" | unreachableWarning.noRoadConnection | Reason mapping |

## src/components/UnassignedPool.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 39 | "POIs sin ruta ({count})" | unassignedPool.title | Section header |
| 83 | title="{name} — arrastrar a un día" | — | Dynamic, uses poi name |

## src/components/FloatingUnassignedPanel.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 28 | "POIs sin ruta" | floatingPOI.title | Section header |
| 31 | "{N} pendiente(s)" | floatingPOI.pending | Plural |
| 59 | "Click para asignar a una ruta" | floatingPOI.clickToAssign | Footer hint |

## src/components/MapPOIActionBar.tsx

| Line | Current Text | Key | Notes |
|------|-------------|-----|-------|
| 48 | "Día {currentDay}" | mapPOI.day | Day label |
| 69 | "Día {d}" | mapPOI.day | Day label |
| 83 | "Sin ruta" | mapPOI.withoutRoute | Button label |
| 92 | aria-label="Aceptar movimiento..." | mapPOI.ariaLabels.acceptMovePOI | Aria label |
| 96 | "Aceptar" | mapPOI.accept | Button text |
| 100 | aria-label="Cancelar movimiento..." | mapPOI.ariaLabels.cancelMovePOI | Aria label |
| 104 | "Cancelar" | mapPOI.cancel | Button text |
