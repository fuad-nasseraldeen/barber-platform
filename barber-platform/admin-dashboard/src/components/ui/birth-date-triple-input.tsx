"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/hooks/use-translation";
import { useLocaleStore } from "@/stores/locale-store";

function daysInMonth(y: number, m: number): number {
  if (!y || !m || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

function toIso(y: number, m: number, d: number): string {
  const dim = daysInMonth(y, m);
  const day = Math.min(Math.max(1, d), dim);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface BirthDateTripleInputProps {
  value: string;
  onChange: (iso: string) => void;
  labelKey?: string;
  className?: string;
}

const inputCls =
  "min-w-0 rounded-xl border border-zinc-300 bg-white px-2 py-2.5 text-center text-sm outline-none transition " +
  "placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200 " +
  "dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 " +
  "dark:focus:border-violet-500 dark:focus:ring-violet-900/40";

const selectCls =
  "min-w-0 rounded-xl border border-zinc-300 bg-white px-2 py-2.5 text-sm outline-none transition " +
  "focus:border-violet-400 focus:ring-2 focus:ring-violet-200 " +
  "dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 " +
  "dark:focus:border-violet-500 dark:focus:ring-violet-900/40";

export function BirthDateTripleInput({
  value,
  onChange,
  labelKey = "customers.birthDate",
  className = "",
}: BirthDateTripleInputProps) {
  const t = useTranslation();
  const dir = useLocaleStore((s) => s.dir);
  const currentYear = new Date().getFullYear();

  const [yStr, setYStr] = useState("");
  const [mStr, setMStr] = useState("");
  const [dStr, setDStr] = useState("");

  useEffect(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setYStr(value.slice(0, 4));
      setMStr(value.slice(5, 7));
      setDStr(value.slice(8, 10));
    } else if (!value) {
      setYStr("");
      setMStr("");
      setDStr("");
    }
  }, [value]);

  const tryEmit = useCallback(
    (yRaw: string, mRaw: string, dRaw: string) => {
      const y = yRaw.trim();
      const m = mRaw.trim();
      const d = dRaw.trim();
      if (!y || !m || !d || y.length !== 4) {
        onChange("");
        return;
      }
      const yi = parseInt(y, 10);
      const mi = parseInt(m, 10);
      const di = parseInt(d, 10);
      if (Number.isNaN(yi) || Number.isNaN(mi) || Number.isNaN(di)) {
        onChange("");
        return;
      }
      if (mi < 1 || mi > 12 || di < 1) {
        onChange("");
        return;
      }
      onChange(toIso(yi, mi, di));
    },
    [onChange],
  );

  const yi = yStr.length === 4 ? parseInt(yStr, 10) : NaN;
  const mi = mStr ? parseInt(mStr, 10) : NaN;
  const maxDay =
    !Number.isNaN(yi) && !Number.isNaN(mi) && mi >= 1 && mi <= 12
      ? daysInMonth(yi, mi)
      : 31;

  const dayOptions = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, "0")),
    [maxDay],
  );

  const yearInput = (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="bday-year"
      maxLength={4}
      placeholder={t("register.year")}
      aria-label={t("register.year")}
      className={`${inputCls} flex-[1.15] sm:flex-[1.05]`}
      value={yStr}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, 4);
        setYStr(v);
        let nextD = dStr;
        if (v.length === 4 && mStr && dStr) {
          const yNum = parseInt(v, 10);
          const mNum = parseInt(mStr, 10);
          const dim = daysInMonth(yNum, mNum);
          if (parseInt(dStr, 10) > dim) {
            nextD = String(dim).padStart(2, "0");
            setDStr(nextD);
          }
        }
        tryEmit(v, mStr, nextD);
      }}
      onBlur={() => {
        if (!yStr) return;
        let yiBlur = parseInt(yStr, 10);
        if (Number.isNaN(yiBlur)) {
          setYStr("");
          tryEmit("", mStr, dStr);
          return;
        }
        if (yiBlur < 1900) yiBlur = 1900;
        if (yiBlur > currentYear) yiBlur = currentYear;
        const ys = String(yiBlur);
        setYStr(ys);
        let nextD = dStr;
        if (mStr && dStr) {
          const miBlur = parseInt(mStr, 10);
          const dim = daysInMonth(yiBlur, miBlur);
          if (parseInt(dStr, 10) > dim) {
            nextD = String(dim).padStart(2, "0");
            setDStr(nextD);
          }
        }
        tryEmit(ys, mStr, nextD);
      }}
    />
  );

  const monthSelect = (
    <select
      aria-label={t("register.month")}
      className={`${selectCls} min-w-0 flex-1`}
      value={mStr}
      onChange={(e) => {
        const v = e.target.value;
        setMStr(v);
        let nextD = dStr;
        if (v && dStr && yStr.length === 4) {
          const yNum = parseInt(yStr, 10);
          const mNum = parseInt(v, 10);
          const dim = daysInMonth(yNum, mNum);
          if (parseInt(dStr, 10) > dim) {
            nextD = String(dim).padStart(2, "0");
            setDStr(nextD);
          }
        }
        tryEmit(yStr, v, nextD);
      }}
    >
      <option value="">{t("register.month")}</option>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => {
        const opt = String(i).padStart(2, "0");
        return (
          <option key={i} value={opt}>
            {t(`register.month${i}`)}
          </option>
        );
      })}
    </select>
  );

  const daySelect = (
    <select
      aria-label={t("register.day")}
      className={`${selectCls} min-w-0 flex-1`}
      value={dStr}
      onChange={(e) => {
        const v = e.target.value;
        setDStr(v);
        tryEmit(yStr, mStr, v);
      }}
    >
      <option value="">{t("register.day")}</option>
      {dayOptions.map((d) => (
        <option key={d} value={d}>
          {parseInt(d, 10)}
        </option>
      ))}
    </select>
  );

  return (
    <div className={className}>
      <div className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t(labelKey)}</div>
      <div className="flex gap-2" dir={dir}>
        {dir === "rtl" ? (
          <>
            {yearInput}
            {monthSelect}
            {daySelect}
          </>
        ) : (
          <>
            {daySelect}
            {monthSelect}
            {yearInput}
          </>
        )}
      </div>
    </div>
  );
}
