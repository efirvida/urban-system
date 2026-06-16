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

  // raw: true so numbers stay as numbers, empty cells as undefined
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

// ─── Step 2: Apply column mapping → validated rows ───────────

/**
 * Given raw rows and a column mapping, produce validated rows.
 * Every row gets a row, invalid ones are marked with isValid=false.
 */
export function applyMapping(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping
): ValidatedRow[] {
  return rows.map((row, idx) => {
    const rawName = String(row[mapping.nameColumn] ?? "").trim();
    const rawLat = String(row[mapping.latColumn] ?? "").trim();
    const rawLng = String(row[mapping.lngColumn] ?? "").trim();

    const parsedLat = parseFloatCoords(rawLat);
    const parsedLng = parseFloatCoords(rawLng);

    const errors: string[] = [];

    if (!rawName) {
      errors.push("Nombre vacío");
    }

    if (isNaN(parsedLat)) {
      errors.push(`Latitud inválida: "${rawLat}"`);
    } else if (parsedLat < -90 || parsedLat > 90) {
      errors.push(`Latitud fuera de rango: ${parsedLat}`);
    }

    if (isNaN(parsedLng)) {
      errors.push(`Longitud inválida: "${rawLng}"`);
    } else if (parsedLng < -180 || parsedLng > 180) {
      errors.push(`Longitud fuera de rango: ${parsedLng}`);
    }

    return {
      id: `row-${idx}`,
      selected: errors.length === 0, // auto-deselect invalid rows
      name: rawName,
      lat: isNaN(parsedLat) ? null : parsedLat,
      lng: isNaN(parsedLng) ? null : parsedLng,
      rawName,
      rawLat,
      rawLng,
      isValid: errors.length === 0,
      validationError: errors.length > 0 ? errors.join("; ") : undefined,
      edited: false,
    };
  });
}

// ─── Helpers ─────────────────────────────────────────────────

/** Parse a coordinate string — handles both "." and "," as decimal sep */
function parseFloatCoords(value: string): number {
  if (!value) return NaN;
  const normalized = value.replace(",", ".");
  return parseFloat(normalized);
}

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
    findCol(["nombre", "name", "location", "dirección", "direccion", "title"]) ??
    columns[0]; // fallback: first column

  const latCol = findCol([
    "latitud",
    "latitude",
    "lat",
    "y",
    "coord_y",
    "coordenada_y",
  ]);

  const lngCol = findCol([
    "longitud",
    "longitude",
    "lng",
    "lon",
    "long",
    "x",
    "coord_x",
    "coordenada_x",
  ]);

  if (!latCol || !lngCol) return null;
  return { nameColumn: nameCol, latColumn: latCol, lngColumn: lngCol };
}

// ─── Convert ValidatedRows to Locations (final step) ─────────

/** Filter selected + valid rows and return Location[] */
export function validatedToLocations(rows: ValidatedRow[]): Location[] {
  return rows
    .filter((r) => r.selected && r.isValid && r.lat !== null && r.lng !== null)
    .map((r) => ({
      name: r.name,
      lat: r.lat!,
      lng: r.lng!,
    }));
}
