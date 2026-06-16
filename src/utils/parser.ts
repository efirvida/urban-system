import * as XLSX from "xlsx";
import { RawFileData, ColumnMapping, ValidatedRow, Location } from "@/types";

// ─── Step 1: Extract raw data from file ──────────────────────

/**
 * Read a spreadsheet buffer and return all columns + all rows
 * without applying any mapping or validation.
 */
export function extractRawData(
  buffer: ArrayBuffer,
  fileName: string
): RawFileData {
  const workbook = XLSX.read(buffer, { type: "array" });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("El archivo no contiene ninguna hoja de cálculo.");
  }

  const sheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: true,
    defval: "",
  });

  if (rows.length === 0) {
    throw new Error("La hoja de cálculo está vacía.");
  }

  const columns = Object.keys(rows[0]);

  return { fileName, columns, rows };
}

// ─── Header row detection ────────────────────────────────────

/**
 * Detect whether the first row looks like column headers rather than data.
 * Heuristic: all values are strings (or mostly strings) and none look like
 * numeric coordinates.
 */
export function detectHeaderRow(
  rows: Record<string, unknown>[]
): { isHeader: boolean; suggestedNames: string[] } {
  if (rows.length === 0) return { isHeader: false, suggestedNames: [] };

  const firstRow = rows[0];
  const values = Object.values(firstRow).map((v) => String(v ?? "").trim());
  const keys = Object.keys(firstRow);

  // If column names contain __EMPTY or are very short, it's likely
  // the spreadsheet had merged cells and xlsx couldn't read headers
  const hasEmptyCols = keys.some(
    (k) => k.startsWith("__EMPTY") || k.length <= 2
  );

  // Check if first row values look like headers (all text, no numbers with decimals)
  const numericCount = values.filter(
    (v) => v !== "" && !isNaN(parseFloat(v.replace(",", ".")))
  ).length;

  const mostlyText = numericCount / values.length < 0.3;

  return {
    isHeader: hasEmptyCols && mostlyText,
    suggestedNames: values.map((v) => v || ""),
  };
}

/**
 * Rebuild raw data using the first row values as column names.
 * Skips the first row (which becomes the header) and re-keys all rows.
 */
export function reheader(
  data: RawFileData,
  newColumnNames: string[]
): RawFileData {
  const oldColumns = data.columns;
  const oldRows = data.rows;

  if (oldRows.length === 0) return data;

  const colMap = new Map<string, string>();
  oldColumns.forEach((oldCol, i) => {
    colMap.set(oldCol, newColumnNames[i]?.trim() || oldCol);
  });

  const newColumns = oldColumns.map((c, i) => newColumnNames[i]?.trim() || c);
  const dataRows = oldRows.slice(1);

  const newRows = dataRows.map((row) => {
    const newRow: Record<string, unknown> = {};
    for (const [oldCol, val] of Object.entries(row)) {
      newRow[colMap.get(oldCol) || oldCol] = val;
    }
    return newRow;
  });

  return { fileName: data.fileName, columns: newColumns, rows: newRows };
}

// ─── Coordinate parsing ──────────────────────────────────────

interface CoordDetail {
  value: number | null;
  raw: string;
  /** Whether the raw value had an explicit sign (- prefix or S/W suffix) */
  explicitSign: boolean;
  /** Whether DMS format was detected (DD°MM'SS") */
  isDMS: boolean;
}

/**
 * Parse a coordinate string, returning detailed info.
 *
 * Supports:
 *   - Decimal:  "-15.744"  or  "-15,744"
 *   - DMS:      "15°02'51.6''"  or  "15°02'51.6\""
 *   - DMS with direction: "15°02'51.6''S"  or  "47°40'10.6''W"
 */
function parseCoordDetailed(raw: string): CoordDetail {
  if (!raw || raw.trim() === "") {
    return { value: null, raw, explicitSign: false, isDMS: false };
  }

  let str = raw.trim().replace(/\s+/g, "");
  const isDMS = str.includes("°");

  let explicitSign = false;
  let sign = 1;

  if (str.endsWith("S") || str.endsWith("W") || str.endsWith("s") || str.endsWith("w")) {
    explicitSign = true;
    sign = -1;
    str = str.slice(0, -1);
  } else if (str.startsWith("-")) {
    explicitSign = true;
    sign = -1;
    str = str.slice(1);
  } else if (str.startsWith("+")) {
    explicitSign = true;
    str = str.slice(1);
  }

  if (!isDMS) {
    const decimal = parseFloat(str.replace(",", "."));
    if (!isNaN(decimal) && isFinite(decimal)) {
      return { value: sign * decimal, raw, explicitSign, isDMS: false };
    }
    return { value: null, raw, explicitSign, isDMS: false };
  }

  // DMS format
  try {
    const normalized = str
      .replace(/''|″|"|´´/g, "'")
      .replace(/´|`|′/g, "'");

    const parts = normalized.split(/[°']/).filter(Boolean);
    if (parts.length < 2) return { value: null, raw, explicitSign, isDMS: true };

    const degrees = parseFloat(parts[0].replace(",", "."));
    const minutes = parseFloat((parts[1] ?? "0").replace(",", "."));
    const seconds =
      parts.length >= 3
        ? parseFloat((parts[2] ?? "0").replace(",", "."))
        : 0;

    if (isNaN(degrees) || isNaN(minutes) || isNaN(seconds)) {
      return { value: null, raw, explicitSign, isDMS: true };
    }

    return {
      value: sign * (degrees + minutes / 60 + seconds / 3600),
      raw,
      explicitSign,
      isDMS: true,
    };
  } catch {
    return { value: null, raw, explicitSign, isDMS: true };
  }
}

/**
 * Infer hemisphere sign for DMS coordinates that lack an explicit direction.
 * If ≥80% of explicit coordinates for a field are negative, assume
 * DMS-without-sign values are also negative (and vice versa).
 */
function inferMissingSigns(details: CoordDetail[]): void {
  const explicitValues = details.filter(
    (d) => d.value !== null && d.explicitSign
  );
  const dmsNoSign = details.filter(
    (d) => d.isDMS && !d.explicitSign && d.value !== null
  );

  if (dmsNoSign.length === 0 || explicitValues.length === 0) return;

  const negCount = explicitValues.filter((d) => d.value! < 0).length;
  const ratio = negCount / explicitValues.length;

  // If ≥80% of explicit coords are negative → flip DMS values to negative
  if (ratio >= 0.8) {
    for (const d of dmsNoSign) {
      if (d.value! > 0) d.value = -d.value!;
    }
  }
}

/** Quick parse for standalone use (no sign inference) */
export function parseCoordinate(raw: string): number | null {
  return parseCoordDetailed(raw).value;
}

// ─── Step 2: Apply column mapping → validated rows ───────────

/**
 * Given raw rows and a column mapping, produce validated rows.
 * Runs sign inference for DMS coordinates without explicit direction.
 */
export function applyMapping(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping
): ValidatedRow[] {
  const n = rows.length;

  // --- Pass 1: Parse all coords with details ---
  const latDetails: CoordDetail[] = [];
  const lngDetails: CoordDetail[] = [];
  const nameValues: string[] = [];

  for (let i = 0; i < n; i++) {
    const row = rows[i];
    nameValues.push(String(row[mapping.nameColumn] ?? "").trim());
    latDetails.push(
      parseCoordDetailed(String(row[mapping.latColumn] ?? "").trim())
    );
    lngDetails.push(
      parseCoordDetailed(String(row[mapping.lngColumn] ?? "").trim())
    );
  }

  // --- Pass 2: Infer sign for DMS without direction ---
  inferMissingSigns(latDetails);
  inferMissingSigns(lngDetails);

  // --- Pass 3: Build ValidatedRows ---
  const result: ValidatedRow[] = [];

  for (let i = 0; i < n; i++) {
    const rawName = nameValues[i];
    const rawLat = latDetails[i].raw;
    const rawLng = lngDetails[i].raw;
    const parsedLat = latDetails[i].value;
    const parsedLng = lngDetails[i].value;

    const errors: string[] = [];

    if (!rawName) errors.push("Nombre vacío");

    if (parsedLat === null) {
      errors.push(`Latitud inválida: "${rawLat}"`);
    } else if (parsedLat < -90 || parsedLat > 90) {
      errors.push(`Latitud fuera de rango: ${parsedLat}`);
    }

    if (parsedLng === null) {
      errors.push(`Longitud inválida: "${rawLng}"`);
    } else if (parsedLng < -180 || parsedLng > 180) {
      errors.push(`Longitud fuera de rango: ${parsedLng}`);
    }

    const isValid = errors.length === 0;

    result.push({
      id: `row-${i}`,
      selected: isValid,
      name: rawName,
      lat: parsedLat,
      lng: parsedLng,
      rawName,
      rawLat,
      rawLng,
      isValid,
      validationError: errors.length > 0 ? errors.join("; ") : undefined,
      edited: false,
    });
  }

  return result;
}

// ─── Auto-detect column mapping ──────────────────────────────

/** Auto-detect column mapping from column names */
export function autoDetectMapping(
  columns: string[]
): ColumnMapping | null {
  const lowerCols = columns.map((c) => c.toLowerCase().trim());

  const findCol = (variants: string[]): string | undefined => {
    const idx = lowerCols.findIndex((c) =>
      variants.some((v) => c === v || c.startsWith(v))
    );
    return idx !== -1 ? columns[idx] : undefined;
  };

  const nameCol =
    findCol([
      "nombre", "name", "propriedade", "propiedad", "property",
      "location", "dirección", "direccion", "title", "estabelecimento",
      "establecimiento", "fazenda", "finca", "farm", "local", "localização",
      "localizacion",
    ]) ?? columns[0];

  const latCol = findCol([
    "latitud", "latitude", "lat", "y", "coord_y", "coordenada_y",
    "coordenaday",
  ]);

  const lngCol = findCol([
    "longitud", "longitude", "lng", "lon", "long", "x", "coord_x",
    "coordenada_x", "coordenadax",
  ]);

  if (!latCol || !lngCol) return null;
  return { nameColumn: nameCol, latColumn: latCol, lngColumn: lngCol };
}

// ─── Convert ValidatedRows to Locations ──────────────────────

/** Filter selected + valid rows and return Location[] */
export function validatedToLocations(rows: ValidatedRow[]): Location[] {
  return rows
    .filter((r) => r.selected && r.isValid && r.lat !== null && r.lng !== null)
    .map((r) => ({ name: r.name, lat: r.lat!, lng: r.lng! }));
}
