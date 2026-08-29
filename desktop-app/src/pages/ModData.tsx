import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Database,
  Download,
  RefreshCw,
  Package,
  Sprout,
  PawPrint,
  Users,
  LoaderCircle,
  FileJson,
  Calendar,
} from "lucide-react"

interface ModExportItemEntry {
  id: string
  name: string
  description: string
  category: number
  price: number
  edibility: number
  type: string
}

interface ModExportCropEntry {
  id: string
  seasons: string[]
  harvestItemId: string
  regrowDays: number
  phases: number[]
}

interface ModExportAnimalEntry {
  id: string
  displayName: string
  house: string
  purchasePrice: number
  daysToMature: number
  daysToProduce: number
  produceItemIds: string[]
}

interface ModExportVillagerEntry {
  id: string
  displayName: string
  birthday: string
  homeRegion: string
  canSocialize: string
  loves: string[]
  likes: string[]
}

interface ModExportSnapshot {
  saveId: string | null
  generatedAt: string | null
  items: ModExportItemEntry[]
  crops: ModExportCropEntry[]
  animals: ModExportAnimalEntry[]
  villagers: ModExportVillagerEntry[]
}

export function ModData({
  onShowToast,
}: {
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [data, setData] = useState<ModExportSnapshot | null>(null)
  const [activeTab, setActiveTab] = useState("items")

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) {
        onShowToast(t("modData.toast.webModeError"), "warning")
        return
      }
      const { invoke } = await import("@tauri-apps/api/core")
      const result = await invoke<ModExportSnapshot | null>("get_mod_export_data")
      setData(result)
      if (result) {
        onShowToast(t("modData.toast.loaded"), "success")
      } else {
        onShowToast(t("modData.toast.noData"), "info")
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      onShowToast(errorMsg, "warning")
    } finally {
      setLoading(false)
    }
  }, [onShowToast, t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleExport = async () => {
    setExporting(true)
    try {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) return
      const { save } = await import("@tauri-apps/plugin-dialog")
      const filePath = await save({
        defaultPath: "mod-data.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      })
      if (!filePath) return
      const { invoke } = await import("@tauri-apps/api/core")
      const path = await invoke<string>("export_mod_data_to_file", { targetPath: filePath })
      onShowToast(t("modData.toast.exported", { path }), "success")
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      onShowToast(errorMsg, "warning")
    } finally {
      setExporting(false)
    }
  }

  const totalCount = data
    ? data.items.length + data.crops.length + data.animals.length + data.villagers.length
    : 0

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Database className="h-8 w-8 text-indigo-500" />
            {t("modData.title")}
          </h2>
          <p className="text-muted-foreground mt-1">{t("modData.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("modData.refresh")}
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={exporting || !data}
            className="gap-2"
          >
            {exporting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("modData.export")}
          </Button>
        </div>
      </div>

      {/* Info bar */}
      {data && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <FileJson className="h-3 w-3" />
            {t("modData.totalEntries", { count: totalCount })}
          </Badge>
          {data.generatedAt && (
            <Badge variant="outline" className="gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(data.generatedAt).toLocaleString()}
            </Badge>
          )}
          {data.saveId && (
            <Badge variant="secondary">{data.saveId}</Badge>
          )}
        </div>
      )}

      {/* Content */}
      {!data && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Database className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">{t("modData.empty.title")}</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
              {t("modData.empty.description")}
            </p>
            <Button variant="outline" className="mt-4 gap-2" onClick={fetchData}>
              <RefreshCw className="h-4 w-4" />
              {t("modData.empty.retry")}
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span>{t("modData.loading")}</span>
        </div>
      )}

      {data && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="items" className="gap-2">
              <Package className="h-4 w-4" />
              {t("modData.tabs.items")}
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                {data.items.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="crops" className="gap-2">
              <Sprout className="h-4 w-4" />
              {t("modData.tabs.crops")}
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                {data.crops.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="animals" className="gap-2">
              <PawPrint className="h-4 w-4" />
              {t("modData.tabs.animals")}
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                {data.animals.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="villagers" className="gap-2">
              <Users className="h-4 w-4" />
              {t("modData.tabs.villagers")}
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                {data.villagers.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="mt-4">
            <ItemList items={data.items} />
          </TabsContent>
          <TabsContent value="crops" className="mt-4">
            <CropList crops={data.crops} />
          </TabsContent>
          <TabsContent value="animals" className="mt-4">
            <AnimalList animals={data.animals} />
          </TabsContent>
          <TabsContent value="villagers" className="mt-4">
            <VillagerList villagers={data.villagers} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function ItemList({ items }: { items: ModExportItemEntry[] }) {
  const { t } = useTranslation()
  if (items.length === 0) {
    return <EmptyState message={t("modData.emptyCategory")} />
  }
  return (
    <ScrollArea className="h-[calc(100vh-360px)]">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-semibold">{item.name}</CardTitle>
                <Badge variant="outline" className="text-xs shrink-0">{item.id}</Badge>
              </div>
              <CardDescription className="text-xs line-clamp-2">{item.description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>💰 {item.price}g</span>
                {item.edibility > 0 && <span>🍎 {item.edibility}</span>}
                <span>📦 {item.type}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}

function CropList({ crops }: { crops: ModExportCropEntry[] }) {
  const { t } = useTranslation()
  if (crops.length === 0) {
    return <EmptyState message={t("modData.emptyCategory")} />
  }
  return (
    <ScrollArea className="h-[calc(100vh-360px)]">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {crops.map((crop) => (
          <Card key={crop.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-semibold">{t("modData.crop")} #{crop.id}</CardTitle>
                <Badge variant="outline" className="text-xs shrink-0">{crop.id}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              <div className="flex flex-wrap gap-1">
                {crop.seasons.map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>🌾 {t("modData.harvestItem")}: {crop.harvestItemId}</p>
                <p>⏱️ {t("modData.totalDays")}: {crop.phases.reduce((a, b) => a + b, 0)}</p>
                {crop.regrowDays > 0 && <p>🔄 {t("modData.regrowDays")}: {crop.regrowDays}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}

function AnimalList({ animals }: { animals: ModExportAnimalEntry[] }) {
  const { t } = useTranslation()
  if (animals.length === 0) {
    return <EmptyState message={t("modData.emptyCategory")} />
  }
  return (
    <ScrollArea className="h-[calc(100vh-360px)]">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {animals.map((animal) => (
          <Card key={animal.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-semibold">{animal.displayName}</CardTitle>
                <Badge variant="outline" className="text-xs shrink-0">{animal.id}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-1 text-xs text-muted-foreground">
              <p>🏠 {t("modData.house")}: {animal.house}</p>
              <p>💰 {t("modData.purchasePrice")}: {animal.purchasePrice}g</p>
              <p>📅 {t("modData.daysToMature")}: {animal.daysToMature}</p>
              {animal.produceItemIds.length > 0 && (
                <p>🥚 {t("modData.produce")}: {animal.produceItemIds.join(", ")}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}

function VillagerList({ villagers }: { villagers: ModExportVillagerEntry[] }) {
  const { t } = useTranslation()
  if (villagers.length === 0) {
    return <EmptyState message={t("modData.emptyCategory")} />
  }
  return (
    <ScrollArea className="h-[calc(100vh-360px)]">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {villagers.map((v) => (
          <Card key={v.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-semibold">{v.displayName}</CardTitle>
                <Badge variant="outline" className="text-xs shrink-0">{v.id}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-1 text-xs text-muted-foreground">
              {v.birthday && <p>🎂 {t("modData.birthday")}: {v.birthday}</p>}
              {v.homeRegion && <p>🏠 {t("modData.homeRegion")}: {v.homeRegion}</p>}
              {v.loves.length > 0 && (
                <p>❤️ {t("modData.loves")}: {v.loves.join(", ")}</p>
              )}
              {v.likes.length > 0 && (
                <p>👍 {t("modData.likes")}: {v.likes.join(", ")}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Package className="h-10 w-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
