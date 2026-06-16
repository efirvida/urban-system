"use client";

import { useCallback, useState, useRef } from "react";
import { Location } from "@/types";
import { parseLocationsFromFile } from "@/utils/parser";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onLocationsLoaded: (locations: Location[]) => void;
}

export default function FileUpload({ onLocationsLoaded }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);

      // Validate extension
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!ext || !["ods", "xlsx", "xls"].includes(ext)) {
        setError(
          "Formato no soportado. Usa archivos .ods, .xlsx o .xls."
        );
        setLoading(false);
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        const locations = parseLocationsFromFile(buffer);
        onLocationsLoaded(locations);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al leer el archivo"
        );
      } finally {
        setLoading(false);
      }
    },
    [onLocationsLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200",
          isDragging
            ? "border-blue-500 bg-blue-50 scale-[1.02]"
            : "border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-400"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".ods,.xlsx,.xls"
          onChange={handleFileChange}
          className="hidden"
        />

        {loading ? (
          <div className="space-y-3">
            <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-sm text-gray-600">Procesando archivo...</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-4xl text-gray-300">📄</div>
            <p className="text-base font-medium text-gray-700">
              Arrastra tu archivo .ods aquí
            </p>
            <p className="text-sm text-gray-400">
              o haz clic para seleccionar (también .xlsx / .xls)
            </p>
            <div className="inline-block text-xs bg-gray-200 rounded px-2 py-1 text-gray-500">
              Columnas: Nombre · Latitud · Longitud
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
