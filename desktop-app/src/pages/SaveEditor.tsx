import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Coins, Heart, LoaderCircle, PencilRuler, RefreshCw, Save, ShieldAlert, TriangleAlert } from "lucide-react"

interface SaveSummary {
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
}

interface EditableFriendship {
  npcName: string
  points: number
}

interface SaveEditorData {
  summary: SaveSummary
  editableFriendships: EditableFriendship[]
}

interface SaveEditorForm {
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
  friendships: EditableFriendship[]
}

const FIELD_LIMITS: Record<keyof Omit<SaveEditorForm, "friendships">, { min: number; max: number }> = {
  money: { min: 0, max: 999999999 },
  totalMoneyEarned: { min: 0, max: 999999999 },
  dayOfMonth: { min: 1, max: 28 },
  season: { min: 0, max: 3 },
  year: { min: 1, max: 999 },
  farmingLevel: { min: 0, max: 10 },
  miningLevel: { min: 0, max: 10 },
  combatLevel: { min: 0, max: 10 },
  foragingLevel: { min: 0, max: 10 },
  fishingLevel: { min: 0, max: 10 },
  deepestMineLevel: { min: 0, max: 999 },
}

const toFormState = (data: SaveEditorData): SaveEditorForm => ({
  money: data.summary.money,
  totalMoneyEarned: data.summary.totalMoneyEarned,
  dayOfMonth: data.summary.dayOfMonth,
  season: data.summary.season,
  year: data.summary.year,
  farmingLevel: data.summary.farmingLevel,
  miningLevel: data.summary.miningLevel,
  combatLevel: data.summary.combatLevel,
  foragingLevel: data.summary.foragingLevel,
  fishingLevel: data.summary.fishingLevel,
  deepestMineLevel: data.summary.deepestMineLevel,
  friendships: data.editableFriendships,
})

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function SaveEditor({
  selectedSaveId,
  onShowToast,
  onSaved,
  warningAcknowledged,
  onAcknowledgeWarning,
  onCancel,
}: {
  selectedSaveId: string
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
  onSaved: () => Promise<void>
  warningAcknowledged: boolean
  onAcknowledgeWarning: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [editorData, setEditorData] = useState<SaveEditorData | null>(null)
  const [form, setForm] = useState<SaveEditorForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [friendshipFilter, setFriendshipFilter] = useState("")

  const SEASONS = [
    t("saveEditor.seasons.spring"),
    t("saveEditor.seasons.summer"),
    t("saveEditor.seasons.fall"),
    t("saveEditor.seasons.winter"),
  ]

  const fetchEditorData = async () => {
    if (!selectedSaveId) {
      setEditorData(null)
      setForm(null)
      setLoading(false)
      return
    }

    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
    if (!isTauri) {
      setEditorData(null)
      setForm(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const data = await invoke<SaveEditorData>("get_save_editor_data", { id: selectedSaveId })
      setEditorData(data)
      setForm(toFormState(data))
    } catch (err) {
      console.error("Failed to load save editor data:", err)
      onShowToast(t("saveEditor.toast.loadError"), "warning")
      setEditorData(null)
      setForm(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!warningAcknowledged) {
      setLoading(false)
      return
    }
    fetchEditorData()
  }, [selectedSaveId, warningAcknowledged])

  const dirty = useMemo(() => {
    if (!editorData || !form) return false
    return JSON.stringify(form) !== JSON.stringify(toFormState(editorData))
  }, [editorData, form])

  const filteredFriendships = useMemo(() => {
    if (!form) return []
    const query = friendshipFilter.trim().toLowerCase()
    if (!query) return form.friendships
    return form.friendships.filter((friendship) => friendship.npcName.toLowerCase().includes(query))
  }, [form, friendshipFilter])

  const updateField = (field: keyof Omit<SaveEditorForm, "friendships">, rawValue: string) => {
    const parsed = Number(rawValue)
    if (Number.isNaN(parsed)) {
      return
    }
    const { min, max } = FIELD_LIMITS[field]
    setForm((current) => current ? { ...current, [field]: clamp(Math.trunc(parsed), min, max) } : current)
  }

  const updateFriendship = (npcName: string, rawValue: string) => {
    const parsed = Number(rawValue)
    if (Number.isNaN(parsed)) {
      return
    }
    setForm((current) => {
      if (!current) return current
      return {
        ...current,
        friendships: current.friendships.map((friendship) =>
          friendship.npcName === npcName
            ? { ...friendship, points: clamp(Math.trunc(parsed), 0, 2500) }
            : friendship
        ),
      }
    })
  }

  const handleReset = () => {
    if (!editorData) return
    setForm(toFormState(editorData))
  }

  const handleSave = async () => {
    if (!form || !selectedSaveId) return
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
    if (!isTauri) {
      onShowToast(t("saveEditor.toast.webModeError"), "warning")
      return
    }

    setSaving(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const updated = await invoke<SaveEditorData>("update_save_editor_data", {
        update: {
          id: selectedSaveId,
          money: form.money,
          totalMoneyEarned: form.totalMoneyEarned,
          dayOfMonth: form.dayOfMonth,
          season: form.season,
          year: form.year,
          farmingLevel: form.farmingLevel,
          miningLevel: form.miningLevel,
          combatLevel: form.combatLevel,
          foragingLevel: form.foragingLevel,
          fishingLevel: form.fishingLevel,
          deepestMineLevel: form.deepestMineLevel,
          friendships: form.friendships,
        },
      })
      setEditorData(updated)
      setForm(toFormState(updated))
      await onSaved()
      onShowToast(t("saveEditor.toast.saveSuccess"), "success")
    } catch (err) {
      console.error("Failed to save edited save:", err)
      onShowToast(t("saveEditor.toast.saveError"), "warning")
    } finally {
      setSaving(false)
    }
  }

  if (!warningAcknowledged) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{t("saveEditor.warningTitle")}</h2>
            <p className="text-muted-foreground mt-2">
              {t("saveEditor.warningDesc")}
            </p>
          </div>

          <Card className="border-amber-300 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/30">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2 text-amber-900 dark:text-amber-100">
                <TriangleAlert className="h-5 w-5" />
                {t("saveEditor.warningCardTitle")}
              </CardTitle>
              <CardDescription className="text-amber-800/90 dark:text-amber-200/90">
                {t("saveEditor.warningCardDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-7 text-amber-950 dark:text-amber-50">
              <p>{t("saveEditor.warningP1")}</p>
              <p>{t("saveEditor.warningP2")}</p>
              <p>{t("saveEditor.warningP3")}</p>
              <p>{t("saveEditor.warningP4")}</p>
              <p>{t("saveEditor.warningP5")}</p>
              <p className="font-medium">{t("saveEditor.warningP6")}</p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={onCancel}>{t("saveEditor.backToDashboard")}</Button>
            <Button variant="destructive" onClick={onAcknowledgeWarning}>{t("saveEditor.acknowledgeAndContinue")}</Button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <LoaderCircle className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">{t("saveEditor.loading")}</p>
        </div>
      </div>
    )
  }

  if (!selectedSaveId || !editorData || !form) {
    return (
      <div className="p-8">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <PencilRuler className="h-5 w-5 text-primary" />
              {t("saveEditor.noSaveTitle")}
            </CardTitle>
            <CardDescription>{t("saveEditor.noSaveDesc")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("saveEditor.title")}</h2>
          <p className="text-muted-foreground mt-1">
            {t("saveEditor.currentSave", {
              playerName: editorData.summary.playerName,
              farmName: editorData.summary.farmName,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t("saveEditor.yearBadge", { year: form.year })}</Badge>
          <Badge variant="secondary">
            {t("saveEditor.dateBadge", { season: SEASONS[form.season], day: form.dayOfMonth })}
          </Badge>
          {dirty && <Badge className="bg-amber-500 text-white hover:bg-amber-500">{t("saveEditor.unsaved")}</Badge>}
          <Button variant="outline" onClick={fetchEditorData} disabled={saving}>
            <RefreshCw className="h-4 w-4" />
            {t("saveEditor.reload")}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={!dirty || saving}>
            {t("saveEditor.resetChanges")}
          </Button>
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("saveEditor.saveSave")}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{t("saveEditor.backupNotice")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Coins className="h-5 w-5 text-yellow-500" />
                {t("saveEditor.coreValues.title")}
              </CardTitle>
              <CardDescription>{t("saveEditor.coreValues.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.coreValues.money")}</span>
                <Input type="number" value={form.money} min={0} max={999999999} onChange={(e) => updateField("money", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.coreValues.totalMoneyEarned")}</span>
                <Input type="number" value={form.totalMoneyEarned} min={0} max={999999999} onChange={(e) => updateField("totalMoneyEarned", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.coreValues.year")}</span>
                <Input type="number" value={form.year} min={1} max={999} onChange={(e) => updateField("year", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.coreValues.dayOfMonth")}</span>
                <Input type="number" value={form.dayOfMonth} min={1} max={28} onChange={(e) => updateField("dayOfMonth", e.target.value)} />
              </label>
              <div className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium">{t("saveEditor.coreValues.season")}</span>
                <div className="grid grid-cols-4 gap-2">
                  {SEASONS.map((seasonLabel, index) => (
                    <Button
                      key={seasonLabel}
                      variant={form.season === index ? "default" : "outline"}
                      onClick={() => setForm((current) => current ? { ...current, season: index } : current)}
                    >
                      {seasonLabel}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("saveEditor.skillsProgress.title")}</CardTitle>
              <CardDescription>{t("saveEditor.skillsProgress.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.skillsProgress.farming")}</span>
                <Input type="number" value={form.farmingLevel} min={0} max={10} onChange={(e) => updateField("farmingLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.skillsProgress.mining")}</span>
                <Input type="number" value={form.miningLevel} min={0} max={10} onChange={(e) => updateField("miningLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.skillsProgress.combat")}</span>
                <Input type="number" value={form.combatLevel} min={0} max={10} onChange={(e) => updateField("combatLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.skillsProgress.foraging")}</span>
                <Input type="number" value={form.foragingLevel} min={0} max={10} onChange={(e) => updateField("foragingLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.skillsProgress.fishing")}</span>
                <Input type="number" value={form.fishingLevel} min={0} max={10} onChange={(e) => updateField("fishingLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("saveEditor.skillsProgress.deepestMineLevel")}</span>
                <Input type="number" value={form.deepestMineLevel} min={0} max={999} onChange={(e) => updateField("deepestMineLevel", e.target.value)} />
              </label>
            </CardContent>
          </Card>
        </div>

        <Card className="min-h-[640px]">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Heart className="h-5 w-5 text-rose-500" />
              {t("saveEditor.friendship.title")}
            </CardTitle>
            <CardDescription>{t("saveEditor.friendship.desc")}</CardDescription>
            <Input
              placeholder={t("saveEditor.friendship.searchPlaceholder")}
              value={friendshipFilter}
              onChange={(e) => setFriendshipFilter(e.target.value)}
            />
          </CardHeader>
          <CardContent className="pt-0">
            <ScrollArea className="h-[520px] pr-3">
              <div className="space-y-3">
                {filteredFriendships.map((friendship) => {
                  const hearts = Math.floor(friendship.points / 250)
                  return (
                    <div key={friendship.npcName} className="grid grid-cols-[minmax(0,1fr)_120px_58px] items-center gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{friendship.npcName}</p>
                        <p className="text-xs text-muted-foreground">{t("saveEditor.friendship.hearts", { hearts })}</p>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        max={2500}
                        value={friendship.points}
                        onChange={(e) => updateFriendship(friendship.npcName, e.target.value)}
                      />
                      <Badge variant="secondary" className="justify-center">{hearts}/10</Badge>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
