"use client"

import { useMemo, useState } from "react"
import { CheckIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { searchZones, type ZoneChoice } from "@/lib/time/zones"

export function ZoneSearch({
  activeIds,
  onAdd,
}: {
  activeIds: string[]
  onAdd: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const results = useMemo(() => searchZones(query), [query])

  function choose(zone: ZoneChoice) {
    if (activeIds.includes(zone.id)) return
    onAdd(zone.id)
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-start gap-2 px-3 font-normal text-muted-foreground"
        >
          <SearchIcon />
          Search a city, country, or timezone
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Amsterdam, Mountain, Netherlands…"
          />
          <CommandList>
            <CommandEmpty>No timezone matches that.</CommandEmpty>
            <CommandGroup heading={query.trim() ? "Matches" : "Common zones"}>
              {results.map((zone) => {
                const added = activeIds.includes(zone.id)
                return (
                  <CommandItem
                    key={zone.id}
                    value={zone.id}
                    disabled={added}
                    data-checked={added || undefined}
                    onSelect={() => choose(zone)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col items-start">
                      <span className="font-medium text-foreground">
                        {zone.city}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[zone.alternativeName, zone.country, zone.dstNote]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {added ? <CheckIcon className="text-foreground" /> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
