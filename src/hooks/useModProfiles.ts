import { useCallback } from "react"
import { Mod } from "@/components/mods/ModList"
import { ModStateEntry } from "@/components/mods/ModProfiles"

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core");
      return mod.invoke;
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err);
    }
  }
  return null;
}

interface UseModProfilesOptions {
  ensureCanModify: () => boolean
  setMods: React.Dispatch<React.SetStateAction<Mod[]>>
}

export function useModProfiles({ ensureCanModify, setMods }: UseModProfilesOptions) {
  const handleApplyProfile = useCallback(async (modStates: ModStateEntry[]) => {
    if (!ensureCanModify()) return

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    const invoke = await getTauriInvoke()

    if (invoke && gameDir) {
      try {
        await invoke("apply_profile", { gameDir, modStates })
        // Update local mod states to match
        const stateMap = new Map(modStates.map((s) => [s.folderName, s.isEnabled]))
        setMods((prev) =>
          prev.map((m) => {
            const cleanFolder = m.folderName.replace(/^\./, "")
            const wantEnabled = stateMap.get(cleanFolder)
            if (wantEnabled !== undefined && m.isEnabled !== wantEnabled) {
              const newFolderName = wantEnabled ? cleanFolder : `.${cleanFolder}`
              return { ...m, isEnabled: wantEnabled, folderName: newFolderName, localPath: `Mods/${newFolderName}` }
            }
            return m
          })
        )
      } catch (err: any) {
        throw err
      }
    } else {
      // Web mock
      const stateMap = new Map(modStates.map((s) => [s.folderName, s.isEnabled]))
      setMods((prev) =>
        prev.map((m) => {
          const cleanFolder = m.folderName.replace(/^\./, "")
          const wantEnabled = stateMap.get(cleanFolder)
          if (wantEnabled !== undefined) {
            return { ...m, isEnabled: wantEnabled }
          }
          return m
        })
      )
    }
  }, [ensureCanModify, setMods])

  return {
    handleApplyProfile,
  }
}
