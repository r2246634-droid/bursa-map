/**
 * Sefer takvimi: hangi gün hangi tarifenin (1 = Pazartesi … 7 = Pazar) uygulanacağı.
 *
 * BURULAŞ: "Resmi tatil günlerinde hat/hareket saatleri, Pazar günü saatleri ile aynıdır."
 * Arife günleri (yarım gün) normal gün tarifesiyle sayılır.
 *
 * Dini bayram tarihleri her yıl değişir; yeni yıl eklenirken resmi takvimden doğrulanmalı.
 * Kaynak (2026–2027): Diyanet takvimi / basında yayımlanan resmi tatil listeleri.
 */

const ISTANBUL_TZ = "Europe/Istanbul";
const SECONDS_PER_DAY = 86_400;

/** Her yıl aynı gün olan resmi tatiller ("AA-GG") */
const FIXED_HOLIDAYS: Record<string, string> = {
  "01-01": "Yılbaşı",
  "04-23": "Ulusal Egemenlik ve Çocuk Bayramı",
  "05-01": "Emek ve Dayanışma Günü",
  "05-19": "Atatürk'ü Anma, Gençlik ve Spor Bayramı",
  "07-15": "Demokrasi ve Millî Birlik Günü",
  "08-30": "Zafer Bayramı",
  "10-29": "Cumhuriyet Bayramı",
};

/** Dini bayramlar ("YYYY-AA-GG"), arife hariç */
const RELIGIOUS_HOLIDAYS: Record<string, string> = {
  "2026-03-20": "Ramazan Bayramı",
  "2026-03-21": "Ramazan Bayramı",
  "2026-03-22": "Ramazan Bayramı",
  "2026-05-27": "Kurban Bayramı",
  "2026-05-28": "Kurban Bayramı",
  "2026-05-29": "Kurban Bayramı",
  "2026-05-30": "Kurban Bayramı",
  "2027-03-09": "Ramazan Bayramı",
  "2027-03-10": "Ramazan Bayramı",
  "2027-03-11": "Ramazan Bayramı",
  "2027-05-16": "Kurban Bayramı",
  "2027-05-17": "Kurban Bayramı",
  "2027-05-18": "Kurban Bayramı",
  "2027-05-19": "Kurban Bayramı",
};

/** Takvimde dini bayram tarihi tanımlı son yıl (sonrası için uyarı verilir) */
export const HOLIDAYS_KNOWN_UNTIL = 2027;

export interface ServiceDay {
  /** "YYYY-AA-GG" (Türkiye saatine göre) */
  date: string;
  /** Takvim günü: 1 = Pazartesi … 7 = Pazar */
  weekday: number;
  /** Uygulanan tarife günü: resmi tatilde 7 (Pazar), diğer günlerde weekday */
  schedule: number;
  /** Resmi tatilse adı */
  holiday: string | null;
}

export function holidayName(isoDate: string): string | null {
  return RELIGIOUS_HOLIDAYS[isoDate] ?? FIXED_HOLIDAYS[isoDate.slice(5)] ?? null;
}

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ISTANBUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Verilen anın Türkiye saatine göre tarifesi ve gece yarısından itibaren saniyesi */
export function serviceClock(date: Date): ServiceDay & { seconds: number } {
  const p = Object.fromEntries(formatter.formatToParts(date).map((x) => [x.type, x.value]));
  const isoDate = `${p.year}-${p.month}-${p.day}`;
  const weekday = WEEKDAYS.indexOf(p.weekday) + 1;
  const holiday = holidayName(isoDate);
  return {
    date: isoDate,
    weekday,
    schedule: holiday ? 7 : weekday,
    holiday,
    seconds: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
  };
}

/** Bir önceki ve sonraki takvim gününün tarifeleri (gece yarısını geçen seferler için) */
export function neighbourSchedules(date: Date): { previous: number; next: number } {
  // Türkiye'de yaz saati uygulaması yok (UTC+3 sabit): ±24 saat her zaman komşu takvim günüdür
  const previous = serviceClock(new Date(date.getTime() - SECONDS_PER_DAY * 1000)).schedule;
  const next = serviceClock(new Date(date.getTime() + SECONDS_PER_DAY * 1000)).schedule;
  return { previous, next };
}
