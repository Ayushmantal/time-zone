import { Temporal } from "./temporal"
import type { Temporal as TemporalTypes } from "@js-temporal/polyfill"
import { isKnownZone, zoneChoice } from "./zones"

type ZonedDateTime = TemporalTypes.ZonedDateTime
type Instant = TemporalTypes.Instant
type PlainDate = TemporalTypes.PlainDate

export type DateParts = { year: number; month: number; day: number }
export type Disambiguation = "earlier" | "later"

export type BoardInput = {
  baseId: string
  layerIds: string[]
  date: DateParts
  hour: number
  minute: number
  disambiguation: Disambiguation
}

type Resolved =
  | { kind: "unique"; zdt: ZonedDateTime }
  | {
      kind: "overlap"
      earlier: ZonedDateTime
      later: ZonedDateTime
    }
  | { kind: "gap" }

export type BoardColumn = {
  id: string
  city: string
  alternativeName: string
  country: string
  dstNote: string | null
  isBase: boolean
  timeLabel: string
  dayNote: string | null
  clockLabel: string
  gapLabel: string
}

export type BoardRow =
  | {
      kind: "gap"
      key: string
      label: string
    }
  | {
      kind: "time"
      key: string
      hour: number
      minute: number
      disambiguation: Disambiguation
      timeLabel: string
      dayPart: string | null
      repeatLabel: string | null
      baseOffset: string
      epochMs: number
      cells: Array<{ timeLabel: string; dayNote: string | null }>
    }

export type BoardModel = {
  dateLabel: string
  columns: BoardColumn[]
  rows: BoardRow[]
  notes: string[]
  copyText: string
  zoneIds: string[]
}

export function offsetMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})/.exec(offset)
  if (!match) return 0
  const sign = match[1] === "-" ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3]))
}

export function formatOffset(offset: string): string {
  const minutes = offsetMinutes(offset)
  if (minutes === 0) return "UTC"
  const sign = minutes < 0 ? "−" : "+"
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const rest = absolute % 60
  return rest === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(rest).padStart(2, "0")}`
}

export function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function gapPhrase(deltaMinutes: number): string {
  if (deltaMinutes === 0) return "same time"
  const absolute = Math.abs(deltaMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  const parts: string[] = []
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`)
  if (minutes) parts.push(`${minutes} min`)
  return `${parts.join(" ")} ${deltaMinutes < 0 ? "earlier" : "later"}`
}

function shiftPhrase(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours} h ${rest} min`
  if (hours === 1) return "1 hour"
  if (hours) return `${hours} hours`
  return `${rest} minutes`
}

function clockName(epochMs: number, timeZone: string, offset: string): string {
  const when = new Date(epochMs)
  const shortName = namePart(when, timeZone, "short")
  const longName = namePart(when, timeZone, "long")
  const utc = formatOffset(offset)
  const season = seasonLabel(longName)
  if (shortName && !/^GMT(?:[+-]|$)/.test(shortName)) {
    return season ? `${shortName} · ${season} · ${utc}` : `${shortName} · ${utc}`
  }
  return season ? `${season} · ${utc}` : utc
}

function namePart(
  when: Date,
  timeZone: string,
  style: "short" | "long",
): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: style,
      })
        .formatToParts(when)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    )
  } catch {
    return ""
  }
}

function seasonLabel(longName: string): string | null {
  const value = longName.toLowerCase()
  if (value.includes("summer") || value.includes("daylight")) return "summer time"
  if (value.includes("standard")) return "standard time"
  return null
}

function fields(
  zone: string,
  date: DateParts,
  hour: number,
  minute: number,
) {
  return {
    timeZone: zone,
    year: date.year,
    month: date.month,
    day: date.day,
    hour,
    minute,
    second: 0,
  }
}

export function resolveLocal(
  zone: string,
  date: DateParts,
  hour: number,
  minute: number,
): Resolved {
  const value = fields(zone, date, hour, minute)
  try {
    return {
      kind: "unique",
      zdt: Temporal.ZonedDateTime.from(value, { disambiguation: "reject" }),
    }
  } catch {
    const earlier = Temporal.ZonedDateTime.from(value, {
      disambiguation: "earlier",
    })
    const later = Temporal.ZonedDateTime.from(value, {
      disambiguation: "later",
    })
    const keptLocalTime =
      earlier.hour === hour &&
      earlier.minute === minute &&
      earlier.day === date.day &&
      later.hour === hour &&
      later.minute === minute &&
      later.day === date.day &&
      earlier.epochMilliseconds !== later.epochMilliseconds
    if (keptLocalTime) return { kind: "overlap", earlier, later }
    return { kind: "gap" }
  }
}

export function sortLayerIds(
  baseId: string,
  layerIds: string[],
  instant: ZonedDateTime,
): string[] {
  const at = instant.toInstant()
  const baseOffset = offsetMinutes(at.toZonedDateTimeISO(baseId).offset)
  return [...new Set(layerIds.filter((id) => id !== baseId && isKnownZone(id)))]
    .sort((a, b) => {
      const distanceA = Math.abs(
        offsetMinutes(at.toZonedDateTimeISO(a).offset) - baseOffset,
      )
      const distanceB = Math.abs(
        offsetMinutes(at.toZonedDateTimeISO(b).offset) - baseOffset,
      )
      return (
        distanceA - distanceB ||
        cityName(a).localeCompare(cityName(b))
      )
    })
}

function cityName(id: string): string {
  return zoneChoice(id)?.city ?? id
}

function dayNote(base: PlainDate, local: PlainDate): string | null {
  const days = base.until(local, { largestUnit: "day" }).days
  if (days === 0) return null
  const label = local.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
  if (days === -1) return `previous day · ${label}`
  if (days === 1) return `next day · ${label}`
  return days < 0
    ? `${Math.abs(days)} days earlier · ${label}`
    : `${days} days later · ${label}`
}

function dayPart(hour: number): string | null {
  if (hour === 0) return "Night"
  if (hour === 6) return "Morning"
  if (hour === 12) return "Afternoon"
  if (hour === 18) return "Evening"
  return null
}

function selectedZoned(
  baseId: string,
  date: DateParts,
  hour: number,
  minute: number,
  disambiguation: Disambiguation,
): ZonedDateTime | null {
  const resolved = resolveLocal(baseId, date, hour, minute)
  if (resolved.kind === "gap") return null
  if (resolved.kind === "unique") return resolved.zdt
  return disambiguation === "later" ? resolved.later : resolved.earlier
}

export function normalizeSelection(
  baseId: string,
  date: DateParts,
  hour: number,
  minute: number,
  disambiguation: Disambiguation,
): { hour: number; minute: number; disambiguation: Disambiguation } {
  const resolved = resolveLocal(baseId, date, hour, minute)
  if (resolved.kind === "unique") {
    return { hour, minute, disambiguation: "earlier" }
  }
  if (resolved.kind === "overlap") {
    return { hour, minute, disambiguation }
  }

  for (let next = hour + 1; next < 24; next += 1) {
    if (resolveLocal(baseId, date, next, minute).kind !== "gap") {
      return { hour: next, minute, disambiguation: "earlier" }
    }
  }
  for (let previous = hour - 1; previous >= 0; previous -= 1) {
    if (resolveLocal(baseId, date, previous, minute).kind !== "gap") {
      return { hour: previous, minute, disambiguation: "earlier" }
    }
  }
  return { hour, minute, disambiguation: "earlier" }
}

function transitionNotes(
  zoneIds: string[],
  start: Instant,
  end: Instant,
): string[] {
  const notes: string[] = []
  for (const id of zoneIds) {
    let cursor = start.toZonedDateTimeISO(id)
    for (let guard = 0; guard < 4; guard += 1) {
      const next = cursor.getTimeZoneTransition("next")
      if (!next) break
      const at = next.toInstant()
      if (Temporal.Instant.compare(at, end) >= 0) break
      if (Temporal.Instant.compare(at, start) < 0) {
        cursor = next
        continue
      }
      const before = Temporal.Instant.fromEpochNanoseconds(
        at.epochNanoseconds - BigInt(1),
      ).toZonedDateTimeISO(id)
      const delta = offsetMinutes(next.offset) - offsetMinutes(before.offset)
      const city = cityName(id)
      const amount = shiftPhrase(Math.abs(delta))
      if (delta > 0) {
        const skippedHour = (before.hour + 1) % 24
        notes.push(
          `${city} jumps forward ${amount} at ${formatClock(next.hour, next.minute)}. ${formatClock(skippedHour, 0)} does not exist.`,
        )
      } else if (delta < 0) {
        notes.push(
          `${city} goes back ${amount} at ${formatClock(next.hour, next.minute)}. ${formatClock(next.hour, 0)} happens twice.`,
        )
      }
      cursor = next
    }
  }
  return notes
}

export function buildBoardModel(input: BoardInput): BoardModel {
  const selection = normalizeSelection(
    input.baseId,
    input.date,
    input.hour,
    input.minute,
    input.disambiguation,
  )
  const selected = selectedZoned(
    input.baseId,
    input.date,
    selection.hour,
    selection.minute,
    selection.disambiguation,
  )
  const anchor =
    selected ??
    Temporal.ZonedDateTime.from(
      {
        timeZone: input.baseId,
        ...input.date,
        hour: 12,
        minute: 0,
        second: 0,
      },
      { disambiguation: "compatible" },
    )

  const layerIds = sortLayerIds(input.baseId, input.layerIds, anchor)
  const zoneIds = [input.baseId, ...layerIds]
  const baseDate = Temporal.PlainDate.from(input.date)
  const start = Temporal.ZonedDateTime.from(
    { timeZone: input.baseId, ...input.date, hour: 0, minute: 0, second: 0 },
    { disambiguation: "compatible" },
  )
  const end = start.add({ days: 1 }).toInstant()

  const rows: BoardRow[] = []
  const hours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]
  for (const hour of hours) {
    const resolved = resolveLocal(
      input.baseId,
      input.date,
      hour,
      selection.minute,
    )
    if (resolved.kind === "gap") {
      rows.push({
        kind: "gap",
        key: `gap-${hour}`,
        label: `${formatClock(hour, selection.minute)} does not exist — clocks jump forward`,
      })
      continue
    }

    const instances =
      resolved.kind === "unique"
        ? [{ disambiguation: "earlier" as const, zdt: resolved.zdt }]
        : [
            { disambiguation: "earlier" as const, zdt: resolved.earlier },
            { disambiguation: "later" as const, zdt: resolved.later },
          ]

    for (const instance of instances) {
      const instant = instance.zdt.toInstant()
      rows.push({
        kind: "time",
        key: `${hour}-${selection.minute}-${instance.disambiguation}`,
        hour,
        minute: selection.minute,
        disambiguation: instance.disambiguation,
        timeLabel: formatClock(instance.zdt.hour, instance.zdt.minute),
        dayPart: dayPart(hour),
        repeatLabel:
          resolved.kind === "overlap"
            ? clockName(
                instance.zdt.epochMilliseconds,
                input.baseId,
                instance.zdt.offset,
              )
            : null,
        baseOffset: instance.zdt.offset,
        epochMs: instance.zdt.epochMilliseconds,
        cells: zoneIds.map((id) => {
          const local = instant.toZonedDateTimeISO(id)
          return {
            timeLabel: formatClock(local.hour, local.minute),
            dayNote: dayNote(baseDate, local.toPlainDate()),
          }
        }),
      })
    }
  }

  const selectedRow = rows.find(
    (row) =>
      row.kind === "time" &&
      row.hour === selection.hour &&
      row.disambiguation === selection.disambiguation,
  )
  const selectedInstant = selected?.toInstant() ?? anchor.toInstant()
  const baseOffset = offsetMinutes(
    selectedInstant.toZonedDateTimeISO(input.baseId).offset,
  )

  const columns: BoardColumn[] = zoneIds.map((id, index) => {
    const local = selectedInstant.toZonedDateTimeISO(id)
    const choice = zoneChoice(id)
    const delta =
      offsetMinutes(local.offset) - baseOffset
    const cell =
      selectedRow && selectedRow.kind === "time"
        ? selectedRow.cells[index]
        : undefined
    return {
      id,
      city: choice?.city ?? id,
      alternativeName: choice?.alternativeName ?? id,
      country: choice?.country ?? "",
      dstNote: choice?.dstNote ?? null,
      isBase: id === input.baseId,
      timeLabel: formatClock(local.hour, local.minute),
      dayNote: cell?.dayNote ?? dayNote(baseDate, local.toPlainDate()),
      clockLabel: clockName(local.epochMilliseconds, id, local.offset),
      gapLabel: id === input.baseId ? "Base" : gapPhrase(delta),
    }
  })

  const dateLabel = baseDate.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const notes = transitionNotes(zoneIds, start.toInstant(), end)
  const copyText = [
    dateLabel,
    "",
    ...columns.map((column) => {
      const when = column.dayNote ? `${column.timeLabel} (${column.dayNote})` : column.timeLabel
      const relation = column.isBase ? column.clockLabel : `${column.clockLabel}, ${column.gapLabel}`
      return `${column.city} — ${when} — ${relation}`
    }),
  ].join("\n")

  return { dateLabel, columns, rows, notes, copyText, zoneIds }
}

export function nowInZone(zone: string): {
  date: DateParts
  hour: number
  minute: number
  disambiguation: Disambiguation
} {
  const zdt = Temporal.Now.zonedDateTimeISO(zone)
  const date = { year: zdt.year, month: zdt.month, day: zdt.day }
  const resolved = resolveLocal(zone, date, zdt.hour, zdt.minute)
  let disambiguation: Disambiguation = "earlier"
  if (resolved.kind === "overlap" && zdt.offset === resolved.later.offset) {
    disambiguation = "later"
  }
  return { date, hour: zdt.hour, minute: zdt.minute, disambiguation }
}
