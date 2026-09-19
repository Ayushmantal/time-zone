"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { CheckIcon, CopyIcon, PinIcon, XIcon } from "lucide-react"

import { ZoneSearch } from "@/components/zone-search"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  buildBoardModel,
  normalizeSelection,
  nowInZone,
  type BoardRow,
  type Disambiguation,
} from "@/lib/time/convert"
import { Temporal } from "@/lib/time/temporal"
import { isKnownZone, zoneChoice } from "@/lib/time/zones"
import { cn } from "cn"

const STORAGE_KEY = "tzboard:v1"

type BoardState = {
  baseId: string
  layerIds: string[]
  year: number
  month: number
  day: number
  hour: number
  minute: number
  disambiguation: Disambiguation
}

const MINUTE_CHOICES = [0, 15, 30, 45]

function loadState(): BoardState {
  const now = nowInZone("Europe/Amsterdam")
  const fallback: BoardState = {
    baseId: "Europe/Amsterdam",
    layerIds: ["America/Denver"],
    ...now.date,
    hour: now.hour,
    minute: now.minute,
    disambiguation: now.disambiguation,
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<BoardState>
    if (!saved.baseId || !isKnownZone(saved.baseId)) return fallback
    const layerIds = (saved.layerIds ?? []).filter(
      (id): id is string => typeof id === "string" && isKnownZone(id) && id !== saved.baseId,
    )
    const date = {
      year: saved.year ?? now.date.year,
      month: saved.month ?? now.date.month,
      day: saved.day ?? now.date.day,
    }
    const selection = normalizeSelection(
      saved.baseId,
      date,
      saved.hour ?? now.hour,
      saved.minute ?? 0,
      saved.disambiguation === "later" ? "later" : "earlier",
    )
    return { baseId: saved.baseId, layerIds, ...date, ...selection }
  } catch {
    return fallback
  }
}

const listeners = new Set<() => void>()
let memory: BoardState | null = null

function emit() {
  for (const listener of listeners) listener()
}

function readState(): BoardState {
  memory ??= loadState()
  return memory
}

function writeState(next: BoardState) {
  memory = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function TimeBoard() {
  const state = useSyncExternalStore(subscribe, readState, () => null)
  if (!state) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading the day…
      </div>
    )
  }

  return (
    <Board
      state={state}
      setState={(updater) => {
        const current = readState()
        writeState(typeof updater === "function" ? updater(current) : updater)
      }}
    />
  )
}

function Board({
  state,
  setState,
}: {
  state: BoardState
  setState: (next: BoardState | ((current: BoardState) => BoardState)) => void
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "shown">("idle")
  const [dateOpen, setDateOpen] = useState(false)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const now = useNow(state.baseId)

  const model = useMemo(
    () =>
      buildBoardModel({
        baseId: state.baseId,
        layerIds: state.layerIds,
        date: { year: state.year, month: state.month, day: state.day },
        hour: state.hour,
        minute: state.minute,
        disambiguation: state.disambiguation,
      }),
    [state],
  )

  useEffect(() => {
    const anomaly = document.querySelector<HTMLElement>("[data-clock-change='true']")
    if (anomaly) {
      anomaly.scrollIntoView({ block: "center", inline: "nearest" })
      return
    }
    selectedRef.current?.scrollIntoView({ block: "center", inline: "nearest" })
  }, [state.year, state.month, state.day, state.baseId])

  const baseCity = zoneChoice(state.baseId)?.city ?? "Base"
  const activeIds = [state.baseId, ...state.layerIds]
  const minutes = MINUTE_CHOICES.includes(state.minute)
    ? MINUTE_CHOICES
    : [...MINUTE_CHOICES, state.minute].sort((a, b) => a - b)
  const selectedDate = new Date(state.year, state.month - 1, state.day)

  function patch(next: Partial<BoardState>) {
    setState((current) => ({ ...current, ...next }))
  }

  function selectRow(row: Extract<BoardRow, { kind: "time" }>) {
    patch({ hour: row.hour, disambiguation: row.disambiguation })
  }

  function changeDate(year: number, month: number, day: number) {
    const selection = normalizeSelection(
      state.baseId,
      { year, month, day },
      state.hour,
      state.minute,
      state.disambiguation,
    )
    patch({ year, month, day, ...selection })
  }

  function makeBase(id: string) {
    if (id === state.baseId) return
    const layerIds = state.layerIds.filter((zoneId) => zoneId !== id)
    layerIds.push(state.baseId)
    const selection = normalizeSelection(
      id,
      { year: state.year, month: state.month, day: state.day },
      state.hour,
      state.minute,
      state.disambiguation,
    )
    patch({ baseId: id, layerIds, ...selection })
  }

  async function copy() {
    const text = model.copyText
    try {
      await navigator.clipboard.writeText(text)
      setCopyState("copied")
    } catch {
      try {
        const area = document.createElement("textarea")
        area.value = text
        area.setAttribute("readonly", "")
        area.style.position = "fixed"
        area.style.left = "-9999px"
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand("copy")
        area.remove()
        setCopyState(ok ? "copied" : "shown")
      } catch {
        setCopyState("shown")
      }
    }
    window.setTimeout(() => setCopyState("idle"), 2500)
  }

  function showClockChange() {
    document
      .querySelector<HTMLElement>("[data-clock-change='true']")
      ?.scrollIntoView({ block: "center", inline: "nearest" })
  }

  function jumpToNow() {
    const current = nowInZone(state.baseId)
    patch({
      ...current.date,
      hour: current.hour,
      minute: current.minute,
      disambiguation: current.disambiguation,
    })
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="shrink-0 space-y-3 border-b px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-xl">
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              When
            </p>
            <h1 className="text-lg font-semibold tracking-tight">{model.dateLabel}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Time runs downward, starting in the morning. {baseCity} stays on the
              left. Added zones line up to the right, closest first.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="font-normal">
                  {model.dateLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (!date) return
                    changeDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
                    setDateOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" onClick={jumpToNow}>
              Now
            </Button>
            <div className="flex items-center rounded-lg border p-0.5">
              {minutes.map((minute) => (
                <Button
                  key={minute}
                  size="xs"
                  variant={minute === state.minute ? "secondary" : "ghost"}
                  onClick={() => patch({ minute })}
                >
                  :{String(minute).padStart(2, "0")}
                </Button>
              ))}
            </div>
            <Button variant="outline" onClick={copy}>
              {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
              {copyState === "copied" ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        {model.notes.length > 0 ? (
          <div className="rounded-lg border bg-muted/60 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Clock change on this day</p>
              <Button size="xs" variant="outline" onClick={showClockChange}>
                Show it on the board
              </Button>
            </div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {model.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {copyState === "shown" ? (
          <textarea
            readOnly
            value={model.copyText}
            className="h-28 w-full rounded-lg border bg-background p-2 text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : null}

        <ZoneSearch
          activeIds={activeIds}
          onAdd={(id) => {
            if (activeIds.includes(id)) return
            patch({ layerIds: [...state.layerIds, id] })
          }}
        />
        <p className="text-xs text-muted-foreground">
          Clock changes follow your browser’s timezone data, so they stay
          current. Nothing is fetched from a time service.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="grid min-w-max"
          style={{
            gridTemplateColumns: `5.75rem repeat(${model.columns.length}, minmax(12.5rem, 1fr))`,
          }}
        >
          <div className="sticky top-0 left-0 z-30 border-r border-b bg-background px-3 py-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Time
          </div>
          {model.columns.map((column) => (
            <div
              key={column.id}
              className="sticky top-0 z-20 border-b bg-background px-3 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{column.city}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[column.alternativeName, column.country].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {column.isBase ? (
                  <Badge variant="secondary">Base</Badge>
                ) : (
                  <div className="flex shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Make ${column.city} the base`}
                          onClick={() => makeBase(column.id)}
                        >
                          <PinIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Make this the base</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remove ${column.city}`}
                          onClick={() =>
                            patch({
                              layerIds: state.layerIds.filter((id) => id !== column.id),
                            })
                          }
                        >
                          <XIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {column.timeLabel}
              </div>
              {column.dayNote ? (
                <div className="text-xs text-muted-foreground">{column.dayNote}</div>
              ) : (
                <div className="text-xs text-muted-foreground">same day</div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">{column.clockLabel}</div>
              <div className="text-xs font-medium">{column.gapLabel}</div>
              {column.dstNote ? (
                <div className="text-xs text-muted-foreground">{column.dstNote}</div>
              ) : null}
            </div>
          ))}

          {model.rows.map((row) =>
            row.kind === "gap" ? (
              <div
                key={row.key}
                data-clock-change="true"
                className="col-span-full border-b bg-muted px-3 py-2 text-sm font-medium"
              >
                {row.label}
              </div>
            ) : (
              <TimeRow
                key={row.key}
                row={row}
                selected={
                  row.hour === state.hour &&
                  row.disambiguation === state.disambiguation
                }
                isNow={
                  now.year === state.year &&
                  now.month === state.month &&
                  now.day === state.day &&
                  now.hour === row.hour &&
                  now.offset === row.baseOffset
                }
                buttonRef={
                  row.hour === state.hour &&
                  row.disambiguation === state.disambiguation
                    ? selectedRef
                    : undefined
                }
                onSelect={() => selectRow(row)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  )
}

function TimeRow({
  row,
  selected,
  isNow,
  onSelect,
  buttonRef,
}: {
  row: Extract<BoardRow, { kind: "time" }>
  selected: boolean
  isNow: boolean
  onSelect: () => void
  buttonRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-clock-change={row.repeatLabel ? "true" : undefined}
        className={cn(
          "sticky left-0 z-10 border-r border-b px-2 py-2 text-left",
          selected ? "bg-foreground text-background" : "bg-background hover:bg-muted/70",
        )}
      >
        {row.dayPart ? (
          <div
            className={cn(
              "text-[10px] font-medium tracking-[0.14em] uppercase",
              selected ? "text-background/70" : "text-muted-foreground",
            )}
          >
            {row.dayPart}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
          {isNow ? (
            <span
              className={cn(
                "size-1.5 rounded-full",
                selected ? "bg-background" : "bg-foreground",
              )}
              aria-label="Now"
            />
          ) : null}
          {row.timeLabel}
        </div>
        {row.repeatLabel ? (
          <div
            className={cn(
              "text-[10px] leading-tight",
              selected ? "text-background/70" : "text-muted-foreground",
            )}
          >
            {row.repeatLabel}
          </div>
        ) : null}
      </button>
      {row.cells.map((cell, index) => (
        <button
          key={`${row.key}-${index}`}
          type="button"
          onClick={onSelect}
          className={cn(
            "border-b px-3 py-2 text-left tabular-nums",
            selected ? "bg-foreground/10" : "hover:bg-muted/50",
            cell.dayNote ? "text-muted-foreground" : "text-foreground",
          )}
        >
          <div className="text-sm font-medium">{cell.timeLabel}</div>
          {cell.dayNote ? (
            <div className="text-[11px] leading-tight">{cell.dayNote}</div>
          ) : null}
        </button>
      ))}
    </>
  )
}

function useNow(zone: string) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  return useMemo(() => {
    const zdt = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(zone)
    return {
      year: zdt.year,
      month: zdt.month,
      day: zdt.day,
      hour: zdt.hour,
      offset: zdt.offset,
    }
  }, [zone, nowMs])
}
