import React, { createContext, useContext, useEffect, useState, useCallback } from "react"

export type BackdropType = "mica" | "acrylic" | "tabbed" | "none"

function normalizeBackdropType(value: string | null): BackdropType {
  switch (value) {
    case "mica":
    case "acrylic":
    case "tabbed":
    case "none":
      return value
    default:
      return "mica"
  }
}

interface BackdropProviderState {
  backdropType: BackdropType
  opacity: number  // 0-100 (percentage)
  backgroundImage: string
  setBackdropType: (type: BackdropType) => void
  setOpacity: (opacity: number) => void
  setBackgroundImage: (path: string) => void
  clearBackgroundImage: () => void
}

const BackdropProviderContext = createContext<BackdropProviderState | undefined>(undefined)

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core")
      return mod.invoke
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err)
    }
  }
  return null
}

export function BackdropProvider({ children }: { children: React.ReactNode }) {
  const [backdropType, setBackdropTypeState] = useState<BackdropType>(() => {
    return normalizeBackdropType(localStorage.getItem("stardew-backdrop-type"))
  })

  const [opacity, setOpacityState] = useState<number>(() => {
    const saved = localStorage.getItem("stardew-backdrop-opacity")
    return saved ? parseInt(saved, 10) : 100
  })

  const [backgroundImage, setBackgroundImageState] = useState<string>(() => {
    return localStorage.getItem("stardew-background-image") || ""
  })

  // Apply CSS variable for panel background opacity (0-100 as percentage)
  useEffect(() => {
    document.documentElement.style.setProperty('--panel-opacity', `${opacity}`)
  }, [opacity])

  // Apply backdrop type as data attribute for CSS styling
  useEffect(() => {
    document.documentElement.setAttribute('data-backdrop', backdropType)
  }, [backdropType])

  // Apply backdrop effect when settings change
  const applyBackdrop = useCallback(async (type: BackdropType) => {
    const invoke = await getTauriInvoke()
    if (!invoke) {
      console.log("Not in Tauri environment, skipping backdrop")
      return
    }

    // Detect if dark mode
    const isDark = document.documentElement.classList.contains("dark")

    const settings = {
      backdropType: type,
      opacity: 255,  // Full opacity for the native effect
      isDark: isDark,
    }

    console.log("Applying backdrop:", settings)

    try {
      await invoke("set_window_backdrop", { settings })
      console.log("Backdrop applied successfully:", type)
    } catch (err) {
      console.error("Failed to set window backdrop:", err)
    }
  }, [])

  // Apply backdrop on mount and when type changes
  useEffect(() => {
    applyBackdrop(backdropType)
  }, [backdropType, applyBackdrop])

  // Re-apply backdrop when theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      applyBackdrop(backdropType)
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [backdropType, applyBackdrop])

  const setBackdropType = useCallback((type: BackdropType) => {
    setBackdropTypeState(type)
    localStorage.setItem("stardew-backdrop-type", type)
  }, [])

  const setOpacity = useCallback((value: number) => {
    setOpacityState(value)
    localStorage.setItem("stardew-backdrop-opacity", value.toString())
  }, [])

  const setBackgroundImage = useCallback(async (path: string) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return

    try {
      const savedPath = await invoke<string>("set_background_image", { path })
      setBackgroundImageState(savedPath)
      localStorage.setItem("stardew-background-image", savedPath)
    } catch (err) {
      console.error("Failed to set background image:", err)
    }
  }, [])

  const clearBackgroundImage = useCallback(async () => {
    const invoke = await getTauriInvoke()
    if (!invoke) return

    try {
      await invoke("clear_background_image")
      setBackgroundImageState("")
      localStorage.removeItem("stardew-background-image")
    } catch (err) {
      console.error("Failed to clear background image:", err)
    }
  }, [])

  return (
    <BackdropProviderContext.Provider
      value={{
        backdropType,
        opacity,
        backgroundImage,
        setBackdropType,
        setOpacity,
        setBackgroundImage,
        clearBackgroundImage,
      }}
    >
      {children}
    </BackdropProviderContext.Provider>
  )
}

export function useBackdrop() {
  const context = useContext(BackdropProviderContext)
  if (context === undefined) {
    throw new Error("useBackdrop must be used within a BackdropProvider")
  }
  return context
}
