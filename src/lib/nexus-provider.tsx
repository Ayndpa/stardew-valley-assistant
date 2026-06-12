import React, { createContext, useContext, useEffect, useState } from "react"

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

interface NexusProviderState {
  nexusLoggedIn: boolean
  nexusUsername: string
  nexusChecking: boolean
  nexusLoggingIn: boolean
  nexusApiKey: string
  nexusApiKeyLoading: boolean
  nexusApiKeyCopied: boolean
  onLogin: () => Promise<void>
  onLogout: () => Promise<void>
  onCopyApiKey: () => Promise<void>
  onRefreshApiKey: () => Promise<void>
}

const NexusProviderContext = createContext<NexusProviderState | undefined>(undefined)

export function NexusProvider({ children }: { children: React.ReactNode }) {
  const [nexusLoggedIn, setNexusLoggedIn] = useState(false)
  const [nexusUsername, setNexusUsername] = useState(() => {
    return localStorage.getItem("nexusUsername") || ""
  })
  const [nexusChecking, setNexusChecking] = useState(false)
  const [nexusLoggingIn, setNexusLoggingIn] = useState(false)
  const [nexusApiKey, setNexusApiKey] = useState(() => {
    return localStorage.getItem("nexusApiKey") || ""
  })
  const [nexusApiKeyLoading, setNexusApiKeyLoading] = useState(false)
  const [nexusApiKeyCopied, setNexusApiKeyCopied] = useState(false)

  // Check NexusMods login status on mount
  useEffect(() => {
    async function checkLogin() {
      const invoke = await getTauriInvoke()
      if (!invoke) {
        console.log("[NexusProvider] Not running in Tauri environment, skipping checkLogin");
        return
      }
      setNexusChecking(true)
      console.log("[NexusProvider] Starting silent login check...");
      try {
        const result = await invoke("check_nexus_login_status") as { loggedIn: boolean; username: string }
        console.log("[NexusProvider] Silent login check result:", result);
        setNexusLoggedIn(result.loggedIn)
        setNexusUsername(result.username || localStorage.getItem("nexusUsername") || "")
        if (result.username) localStorage.setItem("nexusUsername", result.username)
        
        // If logged in, also try to load cached/fresh API key
        if (result.loggedIn) {
          try {
            console.log("[NexusProvider] User is logged in, fetching API key...");
            const keyResult = await invoke("fetch_nexus_api_key") as { apiKey: string; error?: string }
            console.log("[NexusProvider] Fetch API key result:", keyResult);
            if (keyResult.apiKey) {
              setNexusApiKey(keyResult.apiKey)
              localStorage.setItem("nexusApiKey", keyResult.apiKey)
            }
          } catch (keyErr) {
            console.error("[NexusProvider] Failed to fetch API key:", keyErr)
          }
        }
      } catch (err) {
        console.error("[NexusProvider] Failed to check NexusMods login status:", err)
      } finally {
        setNexusChecking(false)
      }
    }
    checkLogin()
  }, [])

  // Listen for login result events from Rust
  useEffect(() => {
    let unlisten: (() => void) | null = null
    async function setupListener() {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) return
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const unsub = await listen<{ status: string; username?: string }>("nexus-login-result", async (event) => {
          console.log("[NexusProvider] Received nexus-login-result event payload:", event.payload);
          if (event.payload.status === "success") {
            setNexusLoggedIn(true)
            const name = event.payload.username || ""
            setNexusUsername(name)
            if (name) localStorage.setItem("nexusUsername", name)
            setNexusLoggingIn(false)
            // Automatically fetch API key after successful login
            try {
              const invoke = await getTauriInvoke()
              if (invoke) {
                setNexusApiKeyLoading(true)
                console.log("[NexusProvider] Auto-fetching API key after login success...");
                const keyResult = await invoke("fetch_nexus_api_key") as { apiKey: string; error?: string }
                console.log("[NexusProvider] Auto-fetch API key result:", keyResult);
                if (keyResult.apiKey) {
                  setNexusApiKey(keyResult.apiKey)
                  localStorage.setItem("nexusApiKey", keyResult.apiKey)
                }
                setNexusApiKeyLoading(false)
              }
            } catch (keyErr) {
              console.error("[NexusProvider] Failed to auto-fetch API key:", keyErr)
              setNexusApiKeyLoading(false)
            }
          } else if (event.payload.status === "timeout") {
            setNexusLoggingIn(false)
          }
        })
        unlisten = unsub
      } catch (err) {
        console.error("[NexusProvider] Failed to setup login listener:", err)
      }
    }
    setupListener()
    return () => { if (unlisten) unlisten() }
  }, [])

  const handleNexusLogin = async () => {
    const invoke = await getTauriInvoke()
    if (!invoke) return
    setNexusLoggingIn(true)
    try {
      await invoke("open_nexus_login_window")
    } catch (err) {
      console.error("Failed to open NexusMods login:", err)
      setNexusLoggingIn(false)
    }
  }

  const handleNexusLogout = async () => {
    const invoke = await getTauriInvoke()
    if (!invoke) return
    try {
      await invoke("logout_nexus")
      setNexusLoggedIn(false)
      setNexusUsername("")
      setNexusApiKey("")
      localStorage.removeItem("nexusUsername")
      localStorage.removeItem("nexusApiKey")
    } catch (err) {
      console.error("Failed to logout NexusMods:", err)
    }
  }

  const handleCopyApiKey = async () => {
    if (!nexusApiKey) return
    try {
      await navigator.clipboard.writeText(nexusApiKey)
      setNexusApiKeyCopied(true)
      setTimeout(() => setNexusApiKeyCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy API key:", err)
    }
  }

  const handleRefreshApiKey = async () => {
    const invoke = await getTauriInvoke()
    if (!invoke) return
    setNexusApiKeyLoading(true)
    try {
      // Clear cache first to force re-fetch
      localStorage.removeItem("nexusApiKey")
      const keyResult = await invoke("fetch_nexus_api_key", { force: true }) as { apiKey: string; error?: string }
      if (keyResult.apiKey) {
        setNexusApiKey(keyResult.apiKey)
        localStorage.setItem("nexusApiKey", keyResult.apiKey)
      }
    } catch (err) {
      console.error("Failed to refresh API key:", err)
    } finally {
      setNexusApiKeyLoading(false)
    }
  }

  return (
    <NexusProviderContext.Provider
      value={{
        nexusLoggedIn,
        nexusUsername,
        nexusChecking,
        nexusLoggingIn,
        nexusApiKey,
        nexusApiKeyLoading,
        nexusApiKeyCopied,
        onLogin: handleNexusLogin,
        onLogout: handleNexusLogout,
        onCopyApiKey: handleCopyApiKey,
        onRefreshApiKey: handleRefreshApiKey,
      }}
    >
      {children}
    </NexusProviderContext.Provider>
  )
}

export function useNexus() {
  const context = useContext(NexusProviderContext)
  if (context === undefined) {
    throw new Error("useNexus must be used within a NexusProvider")
  }
  return context
}
