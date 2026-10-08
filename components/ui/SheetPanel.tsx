"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface SheetPanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Başlığın altında sabit kalan alan (ör. filtre kutusu); liste kaydırılırken yerinde durur */
  toolbar?: ReactNode;
  children: ReactNode;
}

/**
 * Alttan açılan, haritanın büyük kısmını kaplayan liste paneli (Hatlar, Kayıtlı).
 * Kapalıyken DOM'da kalır (kaydırma animasyonu ve liste/filtre durumunun korunması için);
 * `inert` ile odak ve ekran okuyucudan gizlenir.
 */
export default function SheetPanel({ open, title, onClose, toolbar, children }: SheetPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <section
      role="dialog"
      aria-label={title}
      aria-hidden={!open}
      inert={!open}
      className={`absolute inset-x-0 bottom-0 z-[1100] mx-auto flex h-[78%] max-w-lg flex-col rounded-t-3xl bg-white/95 shadow-[0_-8px_30px_rgb(15_23_42/0.15)] backdrop-blur-md transition-transform duration-300 ease-out ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="shrink-0 px-4 pt-2">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`${title} panelini kapat`}
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-900/5"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        {toolbar}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">{children}</div>
    </section>
  );
}
