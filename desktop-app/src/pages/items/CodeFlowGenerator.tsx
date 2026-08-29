import { useMemo, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ItemEntry } from "./types"
import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  Package,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react"

/** Max characters allowed for a single animal name in Stardew Valley */
const MAX_NAME_LENGTH = 20

interface CodeFlowGeneratorProps {
  items: ItemEntry[]
  loading: boolean
  selectedIds: string[]
  onToggleItem: (id: string) => void
  onClearSelected: () => void
}

export function CodeFlowGenerator({
  items,
  loading,
  selectedIds,
  onToggleItem,
  onClearSelected,
}: CodeFlowGeneratorProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  // Build a quick lookup map from items
  const itemMap = useMemo(() => {
    const map = new Map<string, ItemEntry>()
    for (const item of items) {
      map.set(item.id, item)
    }
    return map
  }, [items])

  // Resolve selected items from IDs
  const selectedItems = useMemo(() => {
    return selectedIds
      .map((id) => itemMap.get(id))
      .filter(Boolean) as ItemEntry[]
  }, [selectedIds, itemMap])

  // Generate the code string
  const codeString = useMemo(() => {
    return selectedItems.map((item) => `[${item.id}]`).join("")
  }, [selectedItems])

  const isOverLimit = codeString.length > MAX_NAME_LENGTH

  const handleCopy = useCallback(async () => {
    if (!codeString) return
    try {
      await navigator.clipboard.writeText(codeString)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = codeString
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [codeString])

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <Zap className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-amber-600 dark:text-amber-400">
              {t("codeFlow.infoTitle")}
            </p>
            <p className="text-muted-foreground">{t("codeFlow.infoDesc")}</p>
            <p className="text-xs text-muted-foreground">
              {t("codeFlow.platformWarning")}
            </p>
          </div>
        </div>
      </div>

      {/* Selected items & generated code */}
      <Card className={isOverLimit ? "border-destructive" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{t("codeFlow.selectedItems")}</CardTitle>
            <Badge variant={isOverLimit ? "destructive" : "secondary"}>
              {codeString.length} / {MAX_NAME_LENGTH} {t("codeFlow.chars")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("codeFlow.noSelected")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-full border border-border/60 bg-accent/40 py-1 pl-1 pr-2.5"
                >
                  {item.icon ? (
                    <img
                      src={item.icon}
                      alt=""
                      className="h-5 w-5 object-contain"
                      style={{ imageRendering: "pixelated" }}
                    />
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-muted">
                      <Package className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  <span className="text-xs font-medium">
                    {item.name}
                    <span className="ml-1 text-muted-foreground">#{item.id}</span>
                  </span>
                  <button
                    onClick={() => onToggleItem(item.id)}
                    className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Generated code display */}
          {selectedItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div
                  className={`flex-1 rounded-md border px-4 py-3 font-mono text-lg tracking-wider ${
                    isOverLimit
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : "border-border bg-accent/30 text-foreground"
                  }`}
                >
                  {codeString}
                </div>
                <Button
                  size="sm"
                  variant={copied ? "default" : "outline"}
                  onClick={handleCopy}
                  className="shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      {t("codeFlow.copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      {t("codeFlow.copy")}
                    </>
                  )}
                </Button>
                <Button size="sm" variant="ghost" onClick={onClearSelected} className="shrink-0">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("codeFlow.clear")}
                </Button>
              </div>
              {isOverLimit && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("codeFlow.overLimit")}
                </p>
              )}
            </div>
          )}

          {/* Usage tips */}
          <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground mb-1">
              <Info className="h-3.5 w-3.5" />
              {t("codeFlow.usageTitle")}
            </div>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              <li>• {t("codeFlow.usage1")}</li>
              <li>• {t("codeFlow.usage2")}</li>
              <li>• {t("codeFlow.usage3")}</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Item grid — same data as encyclopedia, with add/remove toggle */}
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("codeFlow.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">{t("codeFlow.noItems")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => {
            const isSelected = selectedIds.includes(item.id)
            return (
              <button
                key={item.id}
                onClick={() => onToggleItem(item.id)}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all cursor-pointer ${
                  isSelected
                    ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                    : "border-border/60 hover:border-border hover:bg-accent/30"
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border bg-accent/40">
                  {item.icon ? (
                    <img
                      src={item.icon}
                      alt=""
                      className="h-6 w-6 object-contain"
                      style={{ imageRendering: "pixelated" }}
                    />
                  ) : (
                    <Package className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    #{item.id} · {item.sellPrice}g
                  </p>
                </div>
                {isSelected ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
