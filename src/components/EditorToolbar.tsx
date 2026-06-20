"use client";

import { Save, Undo2, Redo2, XCircle, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  /** True if there are unsaved changes — gates Apply and Discard. */
  hasChanges: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Toolbar shown at the top of the route editor.
 *
 * - Apply:  commits the working state to the parent result. Disabled
 *           when no changes are pending.
 * - Discard: restores the entry snapshot. Only meaningful when there
 *           are changes; shows a warning state in that case.
 * - Undo / Redo: pop the mutation stacks.
 */
export default function EditorToolbar({
  canUndo,
  canRedo,
  hasChanges,
  onApply,
  onDiscard,
  onUndo,
  onRedo,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-2.5">
      <div className="flex items-center gap-2 mb-2">
        <Pencil className="w-3.5 h-3.5 text-blue-700" />
        <span className="text-xs font-semibold text-blue-800">
          {t("editorToolbar.editMode")}
        </span>
        {hasChanges && (
          <span className="ml-auto text-[10px] font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
            {t("editorToolbar.unsavedChanges")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onApply}
          disabled={!hasChanges}
          aria-label={t("editorToolbar.ariaLabels.applyChanges")}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            hasChanges
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          )}
        >
          <Save className="w-3.5 h-3.5" aria-hidden="true" />
          {t("editorToolbar.apply")}
        </button>

        <button
          type="button"
          onClick={onDiscard}
          disabled={!hasChanges}
          aria-label={t("editorToolbar.ariaLabels.discardChanges")}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors border",
            hasChanges
              ? "bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
              : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
          )}
        >
          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
          {t("editorToolbar.discard")}
        </button>

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label={t("editorToolbar.ariaLabels.undoLastAction")}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            canUndo
              ? "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              : "bg-gray-50 text-gray-300 border border-gray-100 cursor-not-allowed"
          )}
        >
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
          {t("editorToolbar.undo")}
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label={t("editorToolbar.ariaLabels.redoAction")}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            canRedo
              ? "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              : "bg-gray-50 text-gray-300 border border-gray-100 cursor-not-allowed"
          )}
        >
          <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
          {t("editorToolbar.redo")}
        </button>
      </div>
    </div>
  );
}
