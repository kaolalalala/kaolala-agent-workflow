import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

const zhDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const zhDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const zhTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatZhDateTime(value?: string | number | Date) {
  if (!value) {
    return "-";
  }
  return zhDateTimeFormatter.format(new Date(value));
}

export function formatZhDate(value?: string | number | Date) {
  if (!value) {
    return "-";
  }
  return zhDateFormatter.format(new Date(value));
}

export function formatZhTime(value?: string | number | Date) {
  if (!value) {
    return "-";
  }
  return zhTimeFormatter.format(new Date(value));
}
