"use client";

import { Bookmark, Bus, Map as MapIcon, Navigation, type LucideIcon } from "lucide-react";

import { useFavoriteCount } from "@/lib/favorites";

export type TabId = "map" | "lines" | "route" | "saved";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "map", label: "Harita", icon: MapIcon },
  { id: "lines", label: "Hatlar", icon: Bus },
  { id: "route", label: "Rota", icon: Navigation },
  { id: "saved", label: "Kayıtlı", icon: Bookmark },
];

interface BottomNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export default function BottomNav({ active, onChange }: BottomNavProps) {
  const savedCount = useFavoriteCount();
  return (
    <nav
      aria-label="Ana gezinme"
      className="relative z-[1200] border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-16 max-w-md">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = id === active;
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex h-full w-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${
                  isActive ? "text-blue-600" : "text-slate-500"
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                  {id === "saved" && savedCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] leading-4 font-semibold text-white">
                      {savedCount > 99 ? "99+" : savedCount}
                    </span>
                  )}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
