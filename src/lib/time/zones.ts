import { getTimeZones, type TimeZone } from "@vvo/tzdb"

import { Temporal } from "./temporal"

export type ZoneChoice = {
  id: string
  city: string
  country: string
  alternativeName: string
  /** Shown when two results share a name but only one changes its clocks. */
  dstNote: string | null
}

const ALIASES: Record<string, string[]> = {
  "America/Phoenix": ["arizona", "az"],
  "America/Denver": ["mountain", "mt"],
  "America/Los_Angeles": ["pacific", "pt", "la"],
  "America/Chicago": ["central", "ct"],
  "America/New_York": ["eastern", "et", "nyc"],
  "Europe/London": ["uk", "britain", "england", "gmt"],
  "Europe/Amsterdam": ["holland", "netherlands"],
  "Etc/UTC": ["utc", "gmt", "zulu"],
}

const POPULAR_IDS = [
  "Europe/Amsterdam",
  "America/Denver",
  "America/Phoenix",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Etc/UTC",
]

const ZONES = getTimeZones({ includeUtc: true })
const BY_ID = new Map(ZONES.map((zone) => [zone.name, zone]))
const dstCache = new Map<string, boolean>()

function fold(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
}

export function cityOf(zone: TimeZone): string {
  if (zone.name === "Etc/UTC") return "UTC"
  return zone.name.split("/").at(-1)?.replaceAll("_", " ") ?? zone.name
}

export function observesDst(id: string): boolean {
  const cached = dstCache.get(id)
  if (cached !== undefined) return cached

  const year = Temporal.Now.plainDateISO().year
  const january = offsetAtNoon(id, year, 1, 15)
  const july = offsetAtNoon(id, year, 7, 15)
  const observes = january !== july
  dstCache.set(id, observes)
  return observes
}

function offsetAtNoon(id: string, year: number, month: number, day: number) {
  return Temporal.ZonedDateTime.from(
    { timeZone: id, year, month, day, hour: 12, minute: 0, second: 0 },
    { disambiguation: "compatible" },
  ).offset
}

function sharesNameWithDifferentDst(zone: TimeZone): boolean {
  const peers = ZONES.filter(
    (candidate) => candidate.alternativeName === zone.alternativeName,
  )
  if (peers.length < 2) return false
  const flags = new Set(peers.map((peer) => observesDst(peer.name)))
  return flags.size > 1
}

export function zoneChoice(id: string): ZoneChoice | undefined {
  const zone = BY_ID.get(id)
  if (!zone) return undefined
  return toChoice(zone)
}

export function isKnownZone(id: string): boolean {
  return BY_ID.has(id)
}

function toChoice(zone: TimeZone): ZoneChoice {
  const contrast = sharesNameWithDifferentDst(zone)
  return {
    id: zone.name,
    city: cityOf(zone),
    country: zone.countryName,
    alternativeName: zone.alternativeName,
    dstNote: contrast
      ? observesDst(zone.name)
        ? "clocks change"
        : "no clock change"
      : null,
  }
}

function scoreZone(zone: TimeZone, query: string): number {
  const city = fold(cityOf(zone))
  const country = fold(zone.countryName)
  const alternative = fold(zone.alternativeName)
  const id = fold(zone.name.replaceAll("_", " "))
  const abbreviation = fold(zone.abbreviation)
  const cities = zone.mainCities.map((item) => fold(item))
  const aliases = (ALIASES[zone.name] ?? []).map(fold)
  const group = zone.group.map((item) => fold(item.replaceAll("_", " ")))

  if (city === query || cities.some((item) => item === query)) return 100
  if (alternative === query || aliases.some((item) => item === query)) return 90
  if (country === query || fold(zone.countryCode) === query) return 80
  if (abbreviation === query) return 75
  if (city.startsWith(query) || cities.some((item) => item.startsWith(query)))
    return 70
  if (alternative.includes(query) || aliases.some((item) => item.includes(query)))
    return 60
  if (cities.some((item) => item.includes(query))) return 55
  if (country.includes(query)) return 50
  if (id.includes(query) || group.some((item) => item.includes(query))) return 40
  return 0
}

export function searchZones(query: string, limit = 12): ZoneChoice[] {
  const folded = fold(query)
  if (!folded) {
    return POPULAR_IDS.map((id) => BY_ID.get(id))
      .filter((zone): zone is TimeZone => Boolean(zone))
      .map(toChoice)
  }

  return ZONES.map((zone) => ({ zone, score: scoreZone(zone, folded) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || cityOf(a.zone).localeCompare(cityOf(b.zone)),
    )
    .slice(0, limit)
    .map((item) => toChoice(item.zone))
}
