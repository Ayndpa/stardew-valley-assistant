import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Baby,
  LoaderCircle,
  RefreshCw,
  Save,
  Users,
  UserCircle,
  Moon,
  Sun,
} from "lucide-react"

interface ChildInfo {
  name: string
  gender: string
  daysOld: number
  ageStage: number
  darkSkinned: boolean
  idOfParent: string
}

interface ChildrenData {
  children: ChildInfo[]
  hasCrib: boolean
}

const AGE_LABELS = ["newborn", "baby", "crawler", "toddler"] as const
const AGE_DAYS_RANGES = [
  { min: 0, max: 12 },
  { min: 13, max: 26 },
  { min: 27, max: 54 },
  { min: 55, max: 999 },
]

export function Children({
  selectedSaveId,
  onShowToast,
}: {
  selectedSaveId: string
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}) {
  const { t } = useTranslation()
  const [data, setData] = useState<ChildrenData | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [edits, setEdits] = useState<Record<number, Partial<ChildInfo>>>({})

  const fetchData = useCallback(async () => {
    if (!selectedSaveId) {
      setData(null)
      setLoading(false)
      return
    }

    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
    if (!isTauri) {
      setData(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const result = await invoke<ChildrenData>("get_children_data", { id: selectedSaveId })
      setData(result)
      setEdits({})
    } catch (err) {
      console.error("Failed to load children data:", err)
      onShowToast(t("children.toast.loadError"), "warning")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [selectedSaveId, onShowToast, t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const updateEdit = (index: number, field: keyof ChildInfo, value: string | number | boolean) => {
    setEdits((prev) => ({
      ...prev,
      [index]: { ...prev[index], [field]: value },
    }))
  }

  const getDisplayChild = (index: number): ChildInfo => {
    const original = data!.children[index]
    const edit = edits[index]
    if (!edit) return original
    return { ...original, ...edit }
  }

  const isDirty = (index: number): boolean => {
    if (!data) return false
    const edit = edits[index]
    if (!edit) return false
    const original = data.children[index]
    return (
      (edit.name !== undefined && edit.name !== original.name) ||
      (edit.daysOld !== undefined && edit.daysOld !== original.daysOld) ||
      (edit.gender !== undefined && edit.gender !== original.gender) ||
      (edit.darkSkinned !== undefined && edit.darkSkinned !== original.darkSkinned)
    )
  }

  const handleSaveChild = async (index: number) => {
    if (!data) return
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
    if (!isTauri) {
      onShowToast(t("children.toast.webModeError"), "warning")
      return
    }

    const child = getDisplayChild(index)
    setSavingIndex(index)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const result = await invoke<ChildrenData>("update_child", {
        update: {
          saveId: selectedSaveId,
          childIndex: index,
          name: edits[index]?.name ?? null,
          daysOld: edits[index]?.daysOld ?? null,
          gender: edits[index]?.gender ?? null,
          darkSkinned: edits[index]?.darkSkinned ?? null,
        },
      })
      setData(result)
      setEdits({})
      onShowToast(t("children.toast.saveSuccess", { name: child.name }), "success")
    } catch (err) {
      console.error("Failed to save child data:", err)
      onShowToast(t("children.toast.saveError"), "warning")
    } finally {
      setSavingIndex(null)
    }
  }

  const handleResetChild = (index: number) => {
    setEdits((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <LoaderCircle className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">{t("children.loading")}</p>
        </div>
      </div>
    )
  }

  if (!selectedSaveId || !data) {
    return (
      <div className="p-8">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Baby className="h-5 w-5 text-primary" />
              {t("children.noSaveTitle")}
            </CardTitle>
            <CardDescription>{t("children.noSaveDesc")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Baby className="h-8 w-8 text-primary" />
            {t("children.title")}
          </h2>
          <p className="text-muted-foreground mt-1">
            {t("children.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{t("children.childCount", { count: data.children.length })}</Badge>
          {data.hasCrib && <Badge variant="outline">{t("children.hasCrib")}</Badge>}
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" />
            {t("children.reload")}
          </Button>
        </div>
      </div>

      {data.children.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-3">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <p className="text-lg font-medium text-muted-foreground">{t("children.noChildren")}</p>
              <p className="text-sm text-muted-foreground/80">{t("children.noChildrenDesc")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.children.map((_child, index) => {
            const display = getDisplayChild(index)
            const dirty = isDirty(index)
            const saving = savingIndex === index
            const ageLabel = t(`children.stages.${AGE_LABELS[display.ageStage]}`)
            const genderLabel = display.gender === "Male" ? t("children.genderMale") : t("children.genderFemale")

            return (
              <Card key={index} className={dirty ? "border-amber-300 dark:border-amber-700" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <UserCircle className="h-5 w-5 text-primary" />
                      {display.name || t("children.unnamed")}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={display.gender === "Male" ? "default" : "secondary"}>
                        {genderLabel}
                      </Badge>
                      <Badge variant="outline">{ageLabel}</Badge>
                      {dirty && <Badge className="bg-amber-500 text-white hover:bg-amber-500">{t("children.unsaved")}</Badge>}
                    </div>
                  </div>
                  <CardDescription>
                    {t("children.daysOldLabel", { days: display.daysOld })}
                    {" · "}
                    {t("children.stageLabel", { stage: ageLabel })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Name */}
                  <label className="space-y-2 block">
                    <span className="text-sm font-medium">{t("children.fields.name")}</span>
                    <Input
                      value={display.name}
                      onChange={(e) => updateEdit(index, "name", e.target.value)}
                      placeholder={t("children.fields.namePlaceholder")}
                    />
                  </label>

                  {/* Days Old */}
                  <label className="space-y-2 block">
                    <span className="text-sm font-medium">
                      {t("children.fields.daysOld")}
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({t("children.fields.daysOldHint")})
                      </span>
                    </span>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        min={0}
                        max={999}
                        value={display.daysOld}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(999, Math.trunc(Number(e.target.value) || 0)))
                          updateEdit(index, "daysOld", val)
                        }}
                        className="w-24"
                      />
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={Math.min(display.daysOld, 200)}
                        onChange={(e) => updateEdit(index, "daysOld", Number(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      {AGE_DAYS_RANGES.map((range, stage) => (
                        <span key={stage}>
                          {t(`children.stages.${AGE_LABELS[stage]}`)}: {range.min}-{Math.min(range.max, 200)}
                        </span>
                      ))}
                    </div>
                  </label>

                  {/* Gender */}
                  <div className="space-y-2">
                    <span className="text-sm font-medium">{t("children.fields.gender")}</span>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant={display.gender === "Male" ? "default" : "outline"}
                        onClick={() => updateEdit(index, "gender", "Male")}
                        className="gap-2"
                      >
                        <span className="text-base">👦</span>
                        {t("children.genderMale")}
                      </Button>
                      <Button
                        variant={display.gender === "Female" ? "default" : "outline"}
                        onClick={() => updateEdit(index, "gender", "Female")}
                        className="gap-2"
                      >
                        <span className="text-base">👧</span>
                        {t("children.genderFemale")}
                      </Button>
                    </div>
                  </div>

                  {/* Dark Skinned */}
                  <div className="space-y-2">
                    <span className="text-sm font-medium">{t("children.fields.skinTone")}</span>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant={!display.darkSkinned ? "default" : "outline"}
                        onClick={() => updateEdit(index, "darkSkinned", false)}
                        className="gap-2"
                      >
                        <Sun className="h-4 w-4" />
                        {t("children.skinLight")}
                      </Button>
                      <Button
                        variant={display.darkSkinned ? "default" : "outline"}
                        onClick={() => updateEdit(index, "darkSkinned", true)}
                        className="gap-2"
                      >
                        <Moon className="h-4 w-4" />
                        {t("children.skinDark")}
                      </Button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      onClick={() => handleSaveChild(index)}
                      disabled={!dirty || saving}
                      className="gap-2"
                    >
                      {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {t("children.saveChild")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleResetChild(index)}
                      disabled={!dirty || saving}
                    >
                      {t("children.resetChild")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
