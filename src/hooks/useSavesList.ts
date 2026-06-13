import { useState, useEffect, useCallback } from "react"

export interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  money: number
  totalMoneyEarned: number
  dayOfMonth: number
  season: number
  year: number
  farmingLevel: number
  miningLevel: number
  combatLevel: number
  foragingLevel: number
  fishingLevel: number
  deepestMineLevel: number
  millisecondsPlayed: number
  lastSaveTime: number
  farmerAvatar?: string | null
  farmerAvatarError?: string | null
}

export function useSavesList() {
  const [saves, setSaves] = useState<SaveSummary[]>([])
  const [selectedSaveId, setSelectedSaveId] = useState<string>(() => {
    return localStorage.getItem("selectedSaveId") || ""
  })

  const fetchSavesList = useCallback(async () => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const mod = await import("@tauri-apps/api/core");
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const list: SaveSummary[] = await mod.invoke("list_save_files", {
          gameDir: gameDir.trim() || undefined,
        })
        setSaves(list)
        if (list.length > 0) {
          const storedId = localStorage.getItem("selectedSaveId")
          if (storedId && list.some(s => s.id === storedId)) {
            setSelectedSaveId(storedId)
          } else {
            setSelectedSaveId(list[0].id)
            localStorage.setItem("selectedSaveId", list[0].id)
          }
        } else {
          setSelectedSaveId("")
        }
      } catch (err) {
        console.error("Error listing saves:", err)
        setSelectedSaveId("")
      }
    } else {
      setSelectedSaveId("")
    }
  }, [])

  useEffect(() => {
    fetchSavesList()
  }, [fetchSavesList])

  const handleSaveChange = useCallback((id: string) => {
    setSelectedSaveId(id)
    localStorage.setItem("selectedSaveId", id)
  }, [])

  return { saves, selectedSaveId, fetchSavesList, handleSaveChange }
}
