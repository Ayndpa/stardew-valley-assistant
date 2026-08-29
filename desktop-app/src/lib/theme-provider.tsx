import React, { createContext, useContext, useEffect, useState } from "react"

export type ThemeMode = "light" | "dark" | "system"
export type ThemeSeason = "default" | "spring" | "summer" | "fall" | "winter"

interface ThemeProviderState {
  themeMode: ThemeMode
  themeSeason: ThemeSeason
  setThemeMode: (mode: ThemeMode) => void
  setThemeSeason: (season: ThemeSeason) => void
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem("stardew-theme-mode") as ThemeMode) || "system"
  })
  
  const [themeSeason, setThemeSeason] = useState<ThemeSeason>(() => {
    return (localStorage.getItem("stardew-theme-season") as ThemeSeason) || "default"
  })

  useEffect(() => {
    const root = window.document.documentElement

    // Handle Dark Mode
    const applyThemeMode = () => {
      root.classList.remove("light", "dark")

      if (themeMode === "system") {
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        root.classList.add(systemTheme)
      } else {
        root.classList.add(themeMode)
      }
    }

    applyThemeMode()

    // Listen to system theme changes if mode is "system"
    if (themeMode === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
      const handleChange = () => {
        applyThemeMode()
      }
      mediaQuery.addEventListener("change", handleChange)
      return () => mediaQuery.removeEventListener("change", handleChange)
    }
  }, [themeMode])

  useEffect(() => {
    const root = window.document.documentElement
    // Handle Season Color Palette
    root.setAttribute("data-theme", themeSeason)
  }, [themeSeason])

  const handleSetThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode)
    localStorage.setItem("stardew-theme-mode", mode)
  }

  const handleSetThemeSeason = (season: ThemeSeason) => {
    setThemeSeason(season)
    localStorage.setItem("stardew-theme-season", season)
  }

  return (
    <ThemeProviderContext.Provider
      value={{
        themeMode,
        themeSeason,
        setThemeMode: handleSetThemeMode,
        setThemeSeason: handleSetThemeSeason,
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeProviderContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
