import { Location, OdsRow } from "@/types";
import * as XLSX from "xlsx";

/**
 * Parse a .ods (or .xlsx/.xls) file buffer into an array of Locations.
 *
 * Expected columns (case-insensitive):
 *   - "Nombre" (string) — location name
 *   - "Latitud" (number) — latitude
 *   - "Longitud" (number) — longitude
 *
 * @throws Error if the file format is invalid or required columns are missing
 */
export function parseLocationsFromFile(buffer: ArrayBuffer): Location[] {
  const workbook = XLSX.read(buffer, { type: "array" });

  // Use the first sheet
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("El archivo no contiene ninguna hoja de cálculo.");
  }

  const sheet = workbook.Sheets[firstSheetName];

  // Convert to JSON (raw: false to get formatted values)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: "",
  });

  if (rows.length === 0) {
    throw new Error("La hoja de cálculo está vacía.");
  }

  // Find column indices by name (case-insensitive)
  const headers = Object.keys(rows[0]);
  const findHeader = (variants: string[]): string | undefined => {
    return headers.find((h) =>
      variants.some((v) => h.toLowerCase() === v.toLowerCase())
    );
  };

  const nombreCol = findHeader(["nombre"]);
  const latitudCol = findHeader(["latitud", "latitude", "lat"]);
  const longitudCol = findHeader(["longitud", "longitude", "lng", "lon"]);

  if (!nombreCol || !latitudCol || !longitudCol) {
    const missing: string[] = [];
    if (!nombreCol) missing.push("'Nombre'");
    if (!latitudCol) missing.push("'Latitud'");
    if (!longitudCol) missing.push("'Longitud'");
    throw new Error(
      `Columnas requeridas no encontradas: ${missing.join(", ")}. ` +
        `Columnas disponibles: ${headers.join(", ")}`
    );
  }

  const locations: Location[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawNombre = String(row[nombreCol] ?? "").trim();
    const rawLat = parseFloat(String(row[latitudCol]).replace(",", "."));
    const rawLng = parseFloat(String(row[longitudCol]).replace(",", "."));

    if (!rawNombre) {
      continue; // skip rows without a name
    }

    if (isNaN(rawLat) || isNaN(rawLng)) {
      throw new Error(
        `Fila ${i + 2}: coordenadas inválidas para "${rawNombre}". ` +
          `Lat: ${row[latitudCol]}, Lng: ${row[longitudCol]}`
      );
    }

    if (rawLat < -90 || rawLat > 90) {
      throw new Error(
        `Fila ${i + 2}: latitud fuera de rango (-90 a 90) para "${rawNombre}": ${rawLat}`
      );
    }

    if (rawLng < -180 || rawLng > 180) {
      throw new Error(
        `Fila ${i + 2}: longitud fuera de rango (-180 a 180) para "${rawNombre}": ${rawLng}`
      );
    }

    locations.push({
      name: rawNombre,
      lat: rawLat,
      lng: rawLng,
    });
  }

  if (locations.length === 0) {
    throw new Error(
      "No se encontraron ubicaciones válidas en el archivo. " +
        "Asegúrate de que las filas tengan nombre y coordenadas."
    );
  }

  return locations;
}
