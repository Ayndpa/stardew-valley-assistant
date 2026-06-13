import { useEffect, useMemo, useState } from "react"
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

const SEASONS = ["春季", "夏季", "秋季", "冬季"]

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
  const [editorData, setEditorData] = useState<SaveEditorData | null>(null)
  const [form, setForm] = useState<SaveEditorForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [friendshipFilter, setFriendshipFilter] = useState("")

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
      onShowToast("读取存档编辑数据失败。", "warning")
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
      onShowToast("Web 模式下不能写回游戏存档。", "warning")
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
      onShowToast("存档已保存，并自动生成原文件备份。", "success")
    } catch (err) {
      console.error("Failed to save edited save:", err)
      onShowToast("保存存档失败，请检查字段范围。", "warning")
    } finally {
      setSaving(false)
    }
  }

  if (!warningAcknowledged) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">存档编辑警告</h2>
            <p className="text-muted-foreground mt-2">
              在继续之前，请先完整阅读下面的说明。这个页面不是普通的功能页，它会直接改写你的游戏存档文件。
            </p>
          </div>

          <Card className="border-amber-300 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/30">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2 text-amber-900 dark:text-amber-100">
                <TriangleAlert className="h-5 w-5" />
                这是作弊功能
              </CardTitle>
              <CardDescription className="text-amber-800/90 dark:text-amber-200/90">
                进入后你可以直接修改金币、日期、技能等级、矿洞层数和村民好感度。这些内容本应通过正常游玩、规划、尝试和失误慢慢获得。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-7 text-amber-950 dark:text-amber-50">
              <p>
                使用存档编辑器，本质上是在绕过游戏设计。你不再需要承担季节安排失误的后果，也不再需要为了装备、金钱、关系或技能投入时间。短期看这会让进度推进得非常快，但代价通常不是“少刷一点时间”，而是把游戏最核心的成长过程直接跳过去。
              </p>
              <p>
                《星露谷物语》的乐趣很大一部分来自节奏感：种错作物后的补救、前期缺钱时的取舍、礼物送错后的重新规划、矿洞推进时的风险判断，以及一个季节结束后回头看自己到底经营出了什么。你一旦直接改数值，这些原本会形成记忆点的过程，往往就只剩下结果，不再有过程。
              </p>
              <p>
                更现实的问题是，作弊会让很多系统失去意义。金币改太高，采购和生产链会失去压力；技能直接拉满，前中期工具升级、路线选择和赚钱方式会变得空洞；好感度直接提高，会让送礼、节日、对话和角色关系推进显得像一张被跳过的表。看起来你“省了时间”，但实际往往是把后续几十小时本来要慢慢展开的体验压扁了。
              </p>
              <p>
                另外，存档编辑不只影响体验，也有实际风险。错误修改可能导致存档数值不协调、进度失真，严重时甚至造成游戏内显示异常或后续游玩判断混乱。虽然这个工具会自动备份原文件，但备份只能解决“回退”，不能恢复已经被你自己破坏掉的探索感和成长感。
              </p>
              <p>
                如果你只是因为某次误操作、Bug、模组冲突、时间不够，或者单纯不想重打某段内容，那么你至少应该清楚：这不是一个无代价的“便利功能”。它确实能帮你改回结果，但也确实会削弱游戏体验，尤其是第一次游玩或仍在正常推进的存档。
              </p>
              <p className="font-medium">
                只有在你完全理解以上后果，并且明确接受“这会破坏部分甚至大量游戏体验”这一点时，才应该继续进入存档编辑器。
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={onCancel}>返回仪表盘</Button>
            <Button variant="destructive" onClick={onAcknowledgeWarning}>我已知悉后果，仍要继续</Button>
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
          <p className="text-sm text-muted-foreground">正在读取可编辑存档数据...</p>
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
              存档编辑器
            </CardTitle>
            <CardDescription>请选择一个本地存档后再编辑。</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">存档编辑器</h2>
          <p className="text-muted-foreground mt-1">
            当前存档：{editorData.summary.playerName} · {editorData.summary.farmName}农场
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">第 {form.year} 年</Badge>
          <Badge variant="secondary">{SEASONS[form.season]} {form.dayOfMonth} 日</Badge>
          {dirty && <Badge className="bg-amber-500 text-white hover:bg-amber-500">未保存</Badge>}
          <Button variant="outline" onClick={fetchEditorData} disabled={saving}>
            <RefreshCw className="h-4 w-4" />
            重新读取
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={!dirty || saving}>
            重置修改
          </Button>
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存存档
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <p>每次保存都会在原存档目录旁生成时间戳备份文件。建议不要在游戏运行时编辑存档。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Coins className="h-5 w-5 text-yellow-500" />
                核心数值
              </CardTitle>
              <CardDescription>修改金钱、总收益和游戏日期。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">当前金币</span>
                <Input type="number" value={form.money} min={0} max={999999999} onChange={(e) => updateField("money", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">累计收益</span>
                <Input type="number" value={form.totalMoneyEarned} min={0} max={999999999} onChange={(e) => updateField("totalMoneyEarned", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">年份</span>
                <Input type="number" value={form.year} min={1} max={999} onChange={(e) => updateField("year", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">日期</span>
                <Input type="number" value={form.dayOfMonth} min={1} max={28} onChange={(e) => updateField("dayOfMonth", e.target.value)} />
              </label>
              <div className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium">季节</span>
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
              <CardTitle className="text-lg">技能与进度</CardTitle>
              <CardDescription>覆盖五项技能和矿洞进度。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">耕种等级</span>
                <Input type="number" value={form.farmingLevel} min={0} max={10} onChange={(e) => updateField("farmingLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">采矿等级</span>
                <Input type="number" value={form.miningLevel} min={0} max={10} onChange={(e) => updateField("miningLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">战斗等级</span>
                <Input type="number" value={form.combatLevel} min={0} max={10} onChange={(e) => updateField("combatLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">觅食等级</span>
                <Input type="number" value={form.foragingLevel} min={0} max={10} onChange={(e) => updateField("foragingLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">钓鱼等级</span>
                <Input type="number" value={form.fishingLevel} min={0} max={10} onChange={(e) => updateField("fishingLevel", e.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">矿洞最深层</span>
                <Input type="number" value={form.deepestMineLevel} min={0} max={999} onChange={(e) => updateField("deepestMineLevel", e.target.value)} />
              </label>
            </CardContent>
          </Card>
        </div>

        <Card className="min-h-[640px]">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Heart className="h-5 w-5 text-rose-500" />
              村民好感度
            </CardTitle>
            <CardDescription>直接编辑点数，范围 0 到 2500，对应 0 到 10 心。</CardDescription>
            <Input
              placeholder="搜索 NPC 名称"
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
                        <p className="text-xs text-muted-foreground">{hearts} 心</p>
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
