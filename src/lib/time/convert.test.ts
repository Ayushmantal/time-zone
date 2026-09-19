import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildBoardModel,
  gapPhrase,
  sortLayerIds,
} from "./convert"
import { Temporal } from "./temporal"
import { searchZones } from "./zones"

const july = { year: 2026, month: 7, day: 15 }
const january = { year: 2026, month: 1, day: 15 }
const midMarch = { year: 2026, month: 3, day: 15 }

function at(
  zone: string,
  date: { year: number; month: number; day: number },
  hour: number,
) {
  return Temporal.ZonedDateTime.from(
    { timeZone: zone, ...date, hour, minute: 0, second: 0 },
    { disambiguation: "compatible" },
  )
}

test("summer and winter Amsterdam to Denver stay 8 hours apart", () => {
  for (const date of [july, january]) {
    const model = buildBoardModel({
      baseId: "Europe/Amsterdam",
      layerIds: ["America/Denver"],
      date,
      hour: 15,
      minute: 0,
      disambiguation: "earlier",
    })
    const denver = model.columns.find((column) => column.id === "America/Denver")
    assert.equal(denver?.timeLabel, "07:00")
    assert.equal(denver?.gapLabel, "8 hours earlier")
    const firstTime = model.rows.find((row) => row.kind === "time")
    assert.equal(firstTime?.kind === "time" ? firstTime.hour : undefined, 6)
  }
  assert.equal(gapPhrase(-480), "8 hours earlier")
})

test("mid-March the US has changed clocks and Europe has not", () => {
  const model = buildBoardModel({
    baseId: "Europe/Amsterdam",
    layerIds: ["America/Denver", "America/Phoenix"],
    date: midMarch,
    hour: 15,
    minute: 0,
    disambiguation: "earlier",
  })
  const denver = model.columns.find((column) => column.id === "America/Denver")
  const phoenix = model.columns.find((column) => column.id === "America/Phoenix")
  assert.equal(denver?.timeLabel, "08:00")
  assert.equal(denver?.gapLabel, "7 hours earlier")
  assert.equal(phoenix?.timeLabel, "07:00")
  assert.equal(phoenix?.gapLabel, "8 hours earlier")
  assert.deepEqual(
    model.columns.map((column) => column.id),
    ["Europe/Amsterdam", "America/Denver", "America/Phoenix"],
  )
})

test("Arizona does not jump forward with Denver in summer", () => {
  const model = buildBoardModel({
    baseId: "Europe/Amsterdam",
    layerIds: ["America/Denver", "America/Phoenix"],
    date: july,
    hour: 15,
    minute: 0,
    disambiguation: "earlier",
  })
  const denver = model.columns.find((column) => column.id === "America/Denver")
  const phoenix = model.columns.find((column) => column.id === "America/Phoenix")
  assert.equal(denver?.timeLabel, "07:00")
  assert.equal(phoenix?.timeLabel, "06:00")
  assert.equal(phoenix?.gapLabel, "9 hours earlier")
  assert.match(phoenix?.dstNote ?? "", /no clock change/)
  assert.match(denver?.dstNote ?? "", /clocks change/)
})

test("Amsterdam spring forward skips an hour", () => {
  const model = buildBoardModel({
    baseId: "Europe/Amsterdam",
    layerIds: [],
    date: { year: 2026, month: 3, day: 29 },
    hour: 1,
    minute: 0,
    disambiguation: "earlier",
  })
  const gap = model.rows.find((row) => row.kind === "gap")
  assert.ok(gap && gap.kind === "gap")
  assert.match(gap.label, /02:00 does not exist/)
  assert.ok(
    model.notes.some((note) =>
      note.includes("Amsterdam jumps forward 1 hour"),
    ),
  )
})

test("Amsterdam fall back repeats an hour", () => {
  const model = buildBoardModel({
    baseId: "Europe/Amsterdam",
    layerIds: [],
    date: { year: 2026, month: 10, day: 25 },
    hour: 2,
    minute: 0,
    disambiguation: "earlier",
  })
  const repeated = model.rows.filter(
    (row) => row.kind === "time" && row.hour === 2,
  )
  assert.equal(repeated.length, 2)
  assert.ok(
    model.notes.some((note) => note.includes("happens twice")),
  )
})

test("columns reorder when clock rules change the distance", () => {
  const julyOrder = sortLayerIds(
    "Europe/London",
    ["Europe/Amsterdam", "Atlantic/Reykjavik"],
    at("Europe/London", july, 12),
  )
  const januaryOrder = sortLayerIds(
    "Europe/London",
    ["Atlantic/Reykjavik", "Europe/Amsterdam"],
    at("Europe/London", january, 12),
  )
  assert.deepEqual(julyOrder, ["Europe/Amsterdam", "Atlantic/Reykjavik"])
  assert.deepEqual(januaryOrder, ["Atlantic/Reykjavik", "Europe/Amsterdam"])
})

test("search finds a city, a country, and everyday timezone names", () => {
  assert.equal(searchZones("amsterdam")[0]?.id, "Europe/Amsterdam")
  assert.equal(searchZones("netherlands")[0]?.id, "Europe/Amsterdam")
  assert.equal(searchZones("arizona")[0]?.id, "America/Phoenix")
  const mountain = searchZones("mountain").map((zone) => zone.id)
  assert.ok(mountain.includes("America/Denver"))
  assert.ok(mountain.includes("America/Phoenix"))
  assert.equal(searchZones("")[0]?.id, "Europe/Amsterdam")
})
