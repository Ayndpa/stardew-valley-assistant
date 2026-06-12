import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Search,
  Puzzle,
  FolderOpen,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  Save,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  FileCode,
  Power,
  Sliders,
  Terminal,
  Info,
  Download
} from "lucide-react"

// Define Interfaces
interface ModConfigField {
  key: string
  label: string
  type: "boolean" | "number" | "string"
  value: any
  description: string
}

interface Mod {
  id: string
  name: string
  englishName: string
  version: string
  latestVersion: string
  author: string
  description: string
  category: "core" | "content" | "utility" | "expansion"
  isEnabled: boolean
  nexusId?: number
  localPath: string
  dependencies: string[]
  config: ModConfigField[]
}

// Initial Mock Mods Data
const INITIAL_MODS: Mod[] = [
  {
    id: "content-patcher",
    name: "内容补丁",
    englishName: "Content Patcher",
    version: "2.3.0",
    latestVersion: "2.3.0",
    author: "Pathoschild",
    description: "允许载入内容包来自定义游戏（如重绘贴图、替换NPC台词、调整地图数据），而不需要直接修改游戏的原版可执行文件。是绝大多数视觉类与数据类模组的运行基石。",
    category: "core",
    isEnabled: true,
    nexusId: 1915,
    localPath: "Mods/ContentPatcher",
    dependencies: [],
    config: [
      { key: "Enabled", label: "启用该补丁引擎", type: "boolean", value: true, description: "是否整体激活 Content Patcher 对游戏内容的干预" },
      { key: "DebugMode", label: "开启调试模式", type: "boolean", value: false, description: "输出更多详细加载日志在控制台，有助于模组制作者调试" },
      { key: "Locale", label: "默认语言代码", type: "string", value: "zh", description: "模组识别并优先加载的系统语言区域代码" }
    ]
  },
  {
    id: "ui-info-suite-2",
    name: "游戏信息增强套件 2",
    englishName: "UI Info Suite 2",
    version: "2.3.0",
    latestVersion: "2.3.2",
    author: "Annosz",
    description: "在游戏中显示各种非常实用的UI信息和悬浮提示。包括今日运气详情、广告看板上的天气预报、作物成熟的剩余天数、当前NPC在地图上的精准头像位置、洒水器和稻草人作用范围等。",
    category: "utility",
    isEnabled: true,
    nexusId: 1150,
    localPath: "Mods/UIInfoSuite2",
    dependencies: ["content-patcher"],
    config: [
      { key: "ShowLuckMinigame", label: "显示每日运气图标", type: "boolean", value: true, description: "在右上角时钟下侧直接显示今天运气的拟物图标" },
      { key: "ShowCalendarEverywhere", label: "随时打开日历看板", type: "boolean", value: true, description: "允许玩家点击游戏UI右上角的时钟图标，直接呼出日历看板" },
      { key: "ShowExperienceBar", label: "显示即时经验条", type: "boolean", value: true, description: "当获得耕种、采矿等技能经验时，在屏幕边侧弹出经验进度条" },
      { key: "IconSize", label: "图标显示比例", type: "number", value: 10, description: "通知面板与悬浮标志的缩放百分比 (推荐范围: 8 - 14)" }
    ]
  },
  {
    id: "stardew-valley-expanded",
    name: "星露谷物语拓展版 (SVE)",
    englishName: "Stardew Valley Expanded",
    version: "1.14.24",
    latestVersion: "1.14.24",
    author: "FlashShifter",
    description: "星露谷物语最著名的超大型社区扩展模组。向原版游戏中追加了超过 20 个新NPC角色、25 个宏大开阔的新地图区域、全新的大型节日、长达数十万字的角色剧情、以及全新的鱼类、农作物与装备武器。",
    category: "expansion",
    isEnabled: true,
    nexusId: 3753,
    localPath: "Mods/StardewValleyExpanded",
    dependencies: ["content-patcher"],
    config: [
      { key: "OlderSophiaSprite", label: "使用索菲亚成熟头像", type: "boolean", value: false, description: "启用后，NPC索菲亚的立绘与行走图将切换为稍大年龄的风格版本" },
      { key: "ReplaceChimney", label: "重构农庄烟囱", type: "boolean", value: true, description: "将农舍的传统老式烟囱替换为更符合SVE自然唯美主题风格的设计" },
      { key: "ImmersiveFarm2", label: "沉浸式农场适配", type: "boolean", value: true, description: "配合加载 IF2R 大型农场地图 of 专属环境物件渲染" }
    ]
  },
  {
    id: "automate",
    name: "自动化机器",
    englishName: "Automate",
    version: "2.0.2",
    latestVersion: "2.0.4",
    author: "Pathoschild",
    description: "极其好用的便利性功能模组。只需将存储箱放置在任何加工机器（如熔炉、酿酒桶、果酱罐、蛋黄酱机等）的相邻位置，即可自动吸取原材料进行加工，并把产出的成品自动收回箱子中。支持通过道路连成网络。",
    category: "utility",
    isEnabled: true,
    nexusId: 1063,
    localPath: "Mods/Automate",
    dependencies: [],
    config: [
      { key: "ConnectorWidth", label: "连接件传输跨度", type: "number", value: 1, description: "自定义石路、木地板等充当数据线连接机器时的最长跨越格数" },
      { key: "AutomationInterval", label: "自动化检测帧间隔", type: "number", value: 60, description: "机器搜索和加工周期的检测频率（数值越小越及时，但可能对配置较低的电脑造成负担）" },
      { key: "PullItemsFirst", label: "箱子按旧物优先提取", type: "boolean", value: false, description: "如果箱内有同种物品的多个堆叠，是否强制从最早入箱的物品序列开始取料" }
    ]
  },
  {
    id: "tractor-mod",
    name: "现代化拖拉机",
    englishName: "Tractor Mod",
    version: "4.1.2",
    latestVersion: "4.1.2",
    author: "Pathoschild",
    description: "向农场中加入了一台可购买的多功能拖拉机。玩家可以骑上拖拉机，搭配不同的工具在瞬间完成大范围作物的收割、浇水、施肥、除草、碎石以及木材砍伐等繁重作业。",
    category: "utility",
    isEnabled: true,
    nexusId: 1401,
    localPath: "Mods/TractorMod",
    dependencies: [],
    config: [
      { key: "TractorSpeed", label: "拖拉机行驶时速", type: "number", value: 8, description: "驾车时的基础移动速度增量（默认 8，调整过高可能会产生地图穿模问题）" },
      { key: "HarvestRadius", label: "工具作业覆盖半径", type: "number", value: 2, description: "以拖拉机为圆心，向外延伸的工具生效半径范围（格数）" },
      { key: "BuildPrice", label: "车库建造耗费金币", type: "number", value: 150000, description: "在木匠罗宾处购买并建造拖拉机车库所对应的金币数额" }
    ]
  },
  {
    id: "earthy-recolor",
    name: "泥土色调温润重绘",
    englishName: "DaisyNiko's Earthy Recolor",
    version: "1.4.0",
    latestVersion: "1.4.0",
    author: "DaisyNiko",
    description: "全局色彩美化模组。将星露谷原版过于明亮鲜艳甚至在长时间游玩后导致眼疲劳的高饱和绿色与黄色泥土，重绘为柔和、舒适、具有浓郁手绘泥土质感的温和配色方案。",
    category: "content",
    isEnabled: false,
    nexusId: 5255,
    localPath: "Mods/EarthyRecolor",
    dependencies: ["content-patcher"],
    config: [
      { key: "RecolorWater", label: "重绘游戏水体颜色", type: "boolean", value: true, description: "是否将江河湖海也重绘为契合森林泥土色调的蓝绿色调" },
      { key: "RecolorBuildings", label: "原版温室大棚重绘", type: "boolean", value: false, description: "是否让农场本身的自带建筑立面也套用本温和配色" }
    ]
  },
  {
    id: "npc-map-locations",
    name: "村民地图定位",
    englishName: "NPC Map Locations",
    version: "3.0.1",
    latestVersion: "3.0.1",
    author: "Bouhm",
    description: "实时地图辅助模组。在游戏的大地图与悬浮HUD小地图上，直接实时显示每名村民当前的行走轨迹与坐标头像。同时还会显示当日是否有剧情触发、是否可送礼等快捷标识。",
    category: "utility",
    isEnabled: true,
    nexusId: 239,
    localPath: "Mods/NPCMapLocations",
    dependencies: [],
    config: [
      { key: "ShowMinimap", label: "启用HUD小地图", type: "boolean", value: true, description: "是否在游玩画面的右上角显示一块轻量级的雷达小地图" },
      { key: "ShowHiddenNPCs", label: "显示隐藏未结识人物", type: "boolean", value: false, description: "是否在地图上标出沙漏、保镖等尚未正式触发见面的隐藏NPC" }
    ]
  }
]

// Category Translations
const CATEGORY_MAP = {
  all: "全部",
  core: "核心API",
  content: "视觉美化",
  utility: "辅助工具",
  expansion: "大型拓展"
}

export function Mods() {
  const [mods, setMods] = useState<Mod[]>(INITIAL_MODS)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [selectedModId, setSelectedModId] = useState<string>(INITIAL_MODS[0]?.id || "")
  const [activeDetailTab, setActiveDetailTab] = useState<string>("info")

  // Interactive UI Actions States
  const [isScanning, setIsScanning] = useState(false)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" | "warning" } | null>(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)

  // New Mod Form State
  const [newModName, setNewModName] = useState("")
  const [newModEngName, setNewModEngName] = useState("")
  const [newModAuthor, setNewModAuthor] = useState("")
  const [newModDesc, setNewModDesc] = useState("")
  const [newModCategory, setNewModCategory] = useState<"core" | "content" | "utility" | "expansion">("utility")
  const [newModVersion, setNewModVersion] = useState("1.0.0")

  // Selected Mod Reference
  const selectedMod = mods.find((m) => m.id === selectedModId)

  // Auto Dismiss Toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null)
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  // Handlers
  const handleToggleMod = (modId: string) => {
    setMods((prevMods) =>
      prevMods.map((m) => {
        if (m.id === modId) {
          const newStatus = !m.isEnabled
          showToast(`已${newStatus ? "启用" : "禁用"}模组: ${m.name}`, "info")
          return { ...m, isEnabled: newStatus }
        }
        return m
      })
    )
  }

  const showToast = (message: string, type: "success" | "info" | "warning") => {
    setToast({ message, type })
  }

  const handleScanDirectory = () => {
    setIsScanning(true)
    const gameDir = localStorage.getItem("stardewGameDirectory") || "C:\\SteamLibrary\\steamapps\\common\\Stardew Valley"
    setTimeout(() => {
      setIsScanning(false)
      showToast(`扫描成功！已在 [${gameDir}\\Mods] 中检索到 ${mods.length} 个模组文件夹。`, "success")
    }, 1200)
  }

  const handleCheckUpdates = () => {
    setIsCheckingUpdates(true)
    setTimeout(() => {
      setIsCheckingUpdates(false)
      const needsUpdateCount = mods.filter((m) => m.version !== m.latestVersion).length
      if (needsUpdateCount > 0) {
        showToast(`检查完毕！发现 ${needsUpdateCount} 个模组有新版本。请点击黄色卡片升级。`, "warning")
      } else {
        showToast("检查完毕！所有已载入模组均是最新版本。", "success")
      }
    }, 1500)
  }

  const handleOpenFolder = () => {
    const gameDir = localStorage.getItem("stardewGameDirectory") || "C:\\SteamLibrary\\steamapps\\common\\Stardew Valley"
    showToast(`已模拟在文件管理器中打开文件夹: ${gameDir}\\Mods`, "success")
  }

  // Handle configuration changes locally
  const handleConfigChange = (modId: string, key: string, newValue: any) => {
    setMods((prevMods) =>
      prevMods.map((m) => {
        if (m.id === modId) {
          const updatedConfig = m.config.map((field) => {
            if (field.key === key) {
              return { ...field, value: newValue }
            }
            return field
          })
          return { ...m, config: updatedConfig }
        }
        return m
      })
    )
  }

  const handleSaveConfig = () => {
    if (selectedMod) {
      showToast(`模组 [${selectedMod.name}] 的配置参数已保存至本地 config.json。`, "success")
    }
  }

  const handleAddNewMod = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newModName || !newModAuthor) {
      showToast("请完整填写模组名称与作者！", "warning")
      return
    }

    const newId = newModName.toLowerCase().replace(/\s+/g, "-")
    const newModObj: Mod = {
      id: newId,
      name: newModName,
      englishName: newModEngName || newModName,
      version: newModVersion,
      latestVersion: newModVersion,
      author: newModAuthor,
      description: newModDesc || "无详细描述。",
      category: newModCategory,
      isEnabled: true,
      localPath: `Mods/${newModEngName.replace(/\s+/g, "") || newModName}`,
      dependencies: [],
      config: [
        { key: "Enabled", label: "启用该模组", type: "boolean", value: true, description: "控制此模组是否加载生效" }
      ]
    }

    setMods((prev) => [newModObj, ...prev])
    setSelectedModId(newId)
    setIsAddModalOpen(false)
    showToast(`导入成功！模组 [${newModName}] 已加载至列表。`, "success")

    // Reset Form
    setNewModName("")
    setNewModEngName("")
    setNewModAuthor("")
    setNewModDesc("")
    setNewModCategory("utility")
    setNewModVersion("1.0.0")
  }

  const handleDeleteMod = (modId: string) => {
    const modToDelete = mods.find((m) => m.id === modId)
    if (!modToDelete) return

    setMods((prev) => prev.filter((m) => m.id !== modId))
    showToast(`已成功移除模组：${modToDelete.name}`, "info")
    
    // Select the first remaining mod
    const remaining = mods.filter((m) => m.id !== modId)
    if (remaining.length > 0) {
      setSelectedModId(remaining[0].id)
    } else {
      setSelectedModId("")
    }
  }

  // Filter and search computation
  const filteredMods = mods.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.englishName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesCategory = selectedCategory === "all" || m.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Global Statistics
  const totalInstalled = mods.length
  const activeCount = mods.filter((m) => m.isEnabled).length
  const updateAvailableCount = mods.filter((m) => m.version !== m.latestVersion).length

  return (
    <div className="p-8 space-y-6 relative">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl border shadow-xl animate-in slide-in-from-bottom-5 fade-in duration-300 ${
          toast.type === "success" 
            ? "bg-green-50/90 dark:bg-green-950/80 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200" 
            : toast.type === "warning" 
            ? "bg-amber-50/90 dark:bg-amber-950/80 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200" 
            : "bg-blue-50/90 dark:bg-blue-950/80 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
        }`}>
          {toast.type === "success" && <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />}
          {toast.type === "warning" && <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />}
          {toast.type === "info" && <Info className="h-5 w-5 text-blue-500 flex-shrink-0" />}
          <div className="text-sm font-medium pr-4">{toast.message}</div>
          <button 
            onClick={() => setToast(null)} 
            className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors ml-auto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header Panel */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm bg-gradient-to-r from-card to-accent/20">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">模组管理</h2>
            <Badge variant="secondary" className="bg-primary/10 text-primary border border-primary/20 gap-1.5 px-3 py-1 font-semibold rounded-full">
              SMAPI: v4.0.8 (加载完毕)
            </Badge>
          </div>
          <p className="text-muted-foreground mt-2 text-sm max-w-xl">
            对游戏扩展模组的加载进行集中控制。您可以在此处扫描本地模组、进行一键版本查重升级，或者直接对每个模组的本地 <code className="bg-accent/40 px-1 py-0.5 rounded text-xs">config.json</code> 参数进行模拟可视化编辑。
          </p>
        </div>

        {/* Global Statistics Panel */}
        <div className="flex gap-4 self-stretch lg:self-auto">
          <div className="bg-accent/30 dark:bg-accent/10 border border-border/60 rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px]">
            <p className="text-xs text-muted-foreground font-medium">已安装</p>
            <p className="text-2xl font-bold text-foreground mt-0.5">{totalInstalled}</p>
          </div>
          <div className="bg-green-50/50 dark:bg-green-950/10 border border-green-100 dark:border-green-950 rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px]">
            <p className="text-xs text-green-700 dark:text-green-400 font-medium">已启用</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-500 mt-0.5">{activeCount}</p>
          </div>
          <div className={`border rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px] transition-colors ${
            updateAvailableCount > 0 
              ? "bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900" 
              : "bg-accent/30 dark:bg-accent/10 border-border/60"
          }`}>
            <p className={`text-xs font-medium ${updateAvailableCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>可更新</p>
            <p className={`text-2xl font-bold mt-0.5 ${updateAvailableCount > 0 ? "text-amber-500" : "text-foreground"}`}>{updateAvailableCount}</p>
          </div>
        </div>
      </div>

      {/* Toolbar / Actions Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Left Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground" />
          <Input
            placeholder="搜索模组名称、英文名、作者或描述..."
            className="pl-11 h-10 bg-card border border-border shadow-sm rounded-xl focus-visible:ring-primary focus-visible:border-primary transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.currentTarget.value)}
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm("")} 
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground rounded"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Right Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2 h-10 border-border bg-card hover:bg-accent text-sm rounded-xl px-4"
            onClick={handleScanDirectory}
            disabled={isScanning}
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <FolderOpen className="h-4 w-4 text-emerald-500" />
            )}
            {isScanning ? "正在扫描..." : "扫描模组目录"}
          </Button>

          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2 h-10 border-border bg-card hover:bg-accent text-sm rounded-xl px-4"
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdates}
          >
            <RefreshCw className={`h-4 w-4 text-sky-500 ${isCheckingUpdates ? "animate-spin" : ""}`} />
            {isCheckingUpdates ? "正在检测更新..." : "检查更新"}
          </Button>

          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2 h-10 border-border bg-card hover:bg-accent text-sm rounded-xl px-4"
            onClick={handleOpenFolder}
          >
            <FolderOpen className="h-4 w-4 text-amber-500" />
            打开 Mods 目录
          </Button>

          <Button 
            variant="default" 
            size="sm" 
            className="gap-2 h-10 bg-primary hover:bg-primary/95 text-primary-foreground text-sm font-semibold rounded-xl px-4 shadow-sm"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus className="h-4 w-4" />
            导入新模组
          </Button>
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Area: Filter Tabs & Mod Cards (8 cols on XL, 12 on normal) */}
        <div className="xl:col-span-7 space-y-4">
          {/* Category Tabs */}
          <div className="flex gap-1.5 p-1 bg-accent/30 dark:bg-accent/10 border border-border/80 rounded-xl overflow-x-auto max-w-full">
            {(Object.keys(CATEGORY_MAP) as Array<keyof typeof CATEGORY_MAP>).map((catKey) => (
              <button
                key={catKey}
                onClick={() => setSelectedCategory(catKey)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                  selectedCategory === catKey
                    ? "bg-card text-primary shadow-sm border border-border/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/40"
                }`}
              >
                {CATEGORY_MAP[catKey]}
                {catKey !== "all" && (
                  <span className="ml-1.5 px-1.5 py-0.25 bg-muted dark:bg-muted/30 text-muted-foreground text-[10px] rounded-full">
                    {mods.filter(m => m.category === catKey).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* List of Mod Cards */}
          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {filteredMods.length === 0 ? (
              <Card className="border border-dashed border-border py-16 flex flex-col items-center justify-center text-center">
                <Puzzle className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <h3 className="text-lg font-bold text-muted-foreground">没有检索到模组</h3>
                <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
                  尝试更改您的搜索词，或者选择其他的分类筛选。
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-4 rounded-xl"
                  onClick={() => { setSearchTerm(""); setSelectedCategory("all"); }}
                >
                  清除所有筛选条件
                </Button>
              </Card>
            ) : (
              filteredMods.map((mod) => {
                const hasUpdate = mod.version !== mod.latestVersion
                const isSelected = mod.id === selectedModId
                return (
                  <div
                    key={mod.id}
                    className={`group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? "bg-accent/40 dark:bg-accent/20 border-primary shadow-md ring-1 ring-primary/20"
                        : "bg-card hover:bg-accent/30 dark:hover:bg-accent/10 border-border hover:border-border-accent shadow-sm"
                    } ${!mod.isEnabled ? "opacity-65 hover:opacity-85" : ""}`}
                    onClick={() => {
                      setSelectedModId(mod.id)
                      setActiveDetailTab("info") // Default back to info tab on switch
                    }}
                  >
                    {/* Update Indicator Side-Border */}
                    {hasUpdate && mod.isEnabled && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 rounded-l-xl" />
                    )}

                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Checkbox & Meta */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* Status Toggle Switch (Small) */}
                        <div 
                          className="mt-1 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation() // Don't trigger selection
                            handleToggleMod(mod.id)
                          }}
                        >
                          <button
                            type="button"
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                              mod.isEnabled ? "bg-primary" : "bg-muted-foreground/30"
                            }`}
                          >
                            <span
                              className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                                mod.isEnabled ? "translate-x-4.5" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                        </div>

                        {/* Mod Names */}
                        <div className="min-w-0">
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                            <h4 className="font-bold text-base truncate group-hover:text-primary transition-colors">
                              {mod.name}
                            </h4>
                            <span className="text-xs text-muted-foreground font-mono truncate max-w-[140px] lg:max-w-xs">
                              {mod.englishName}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 font-medium">
                            作者: {mod.author} · 本地版本: v{mod.version}
                          </p>
                          <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-1">
                            {mod.description}
                          </p>
                        </div>
                      </div>

                      {/* Right: Badges & Trash */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <Badge 
                          variant="secondary" 
                          className={`text-[10px] font-bold py-0.5 px-2 rounded-md ${
                            mod.category === "core" 
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200/50 dark:border-purple-900/40" 
                              : mod.category === "content" 
                              ? "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300 border border-pink-200/50 dark:border-pink-900/40"
                              : mod.category === "expansion"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-900/40"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200/50 dark:border-blue-900/40"
                          }`}
                        >
                          {CATEGORY_MAP[mod.category]}
                        </Badge>

                        {/* Has Update Badge */}
                        {hasUpdate ? (
                          <Badge className="bg-amber-500 hover:bg-amber-600 text-white border-none text-[10px] font-bold flex items-center gap-0.5 py-0.5 px-1.5 animate-pulse rounded-md">
                            可升级 v{mod.latestVersion}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-green-600 dark:text-green-400 border-green-200 dark:border-green-900/40 bg-green-500/5 dark:bg-green-500/2 py-0.5 px-1.5 rounded-md">
                            最新版
                          </Badge>
                        )}

                        {/* Delete Button (Only displays on hover/select) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if(confirm(`确定要从列表中移除模组 [${mod.name}] 吗？`)) {
                              handleDeleteMod(mod.id)
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/15 text-muted-foreground hover:text-destructive rounded transition-all mt-1"
                          title="移除该模组"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Area: Mod Details & Interactive Configuration (5 cols on XL, 12 on normal) */}
        <div className="xl:col-span-5">
          {selectedMod ? (
            <Card className="border border-border shadow-md rounded-xl overflow-hidden bg-card">
              {/* Card Banner / Title */}
              <div className="p-6 pb-4 bg-gradient-to-b from-accent/30 dark:from-accent/15 to-transparent border-b border-border/50">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <Puzzle className="h-5 w-5 text-primary" />
                      {selectedMod.name}
                    </h3>
                    <p className="text-xs text-muted-foreground font-mono mt-1">
                      {selectedMod.englishName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedMod.isEnabled ? "default" : "secondary"} className={selectedMod.isEnabled ? "bg-green-600 hover:bg-green-600" : ""}>
                      {selectedMod.isEnabled ? "已启用" : "已禁用"}
                    </Badge>
                  </div>
                </div>

                {/* Subinfo Row */}
                <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mt-4 text-xs text-muted-foreground">
                  <div>
                    作者: <span className="font-semibold text-foreground">{selectedMod.author}</span>
                  </div>
                  <div>
                    当前版本: <span className="font-semibold text-foreground">v{selectedMod.version}</span>
                  </div>
                  {selectedMod.nexusId && (
                    <a
                      href={`https://www.nexusmods.com/stardewvalley/mods/${selectedMod.nexusId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-0.5"
                    >
                      Nexus ID: {selectedMod.nexusId}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* Tabs list inside details panel */}
              <Tabs value={activeDetailTab} onValueChange={setActiveDetailTab} className="w-full">
                <div className="px-6 border-b border-border/60">
                  <TabsList className="bg-transparent h-10 p-0 gap-4 w-full justify-start border-none">
                    <TabsTrigger
                      value="info"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
                    >
                      <Info className="h-3.5 w-3.5 mr-1" />
                      模组信息
                    </TabsTrigger>
                    <TabsTrigger
                      value="config"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
                    >
                      <Sliders className="h-3.5 w-3.5 mr-1" />
                      参数配置
                    </TabsTrigger>
                    <TabsTrigger
                      value="files"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
                    >
                      <FileCode className="h-3.5 w-3.5 mr-1" />
                      配置文件
                    </TabsTrigger>
                    <TabsTrigger
                      value="logs"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
                    >
                      <Terminal className="h-3.5 w-3.5 mr-1" />
                      运行日志
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Tab: Info */}
                <TabsContent value="info" className="p-6 space-y-4 outline-none">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-1.5">模组描述</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {selectedMod.description}
                    </p>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground block mb-0.5">SMAPI 依赖项</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedMod.dependencies.length > 0 ? (
                          selectedMod.dependencies.map((dep) => (
                            <Badge key={dep} variant="outline" className="text-[10px] py-0 px-1.5">
                              {dep}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground italic">无依赖项</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5">本地存放路径</span>
                      <span className="font-mono bg-accent/40 px-1.5 py-0.5 rounded text-[10px] break-all inline-block mt-1 text-foreground">
                        {selectedMod.localPath}
                      </span>
                    </div>
                  </div>

                  {selectedMod.version !== selectedMod.latestVersion && (
                    <div className="bg-amber-500/10 border border-amber-200/50 dark:border-amber-900/30 p-3.5 rounded-xl flex items-start gap-2.5">
                      <AlertTriangle className="h-4.5 w-4.5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                          发现新版本 v{selectedMod.latestVersion} 可升级
                        </p>
                        <p className="text-[11px] text-amber-700/90 dark:text-amber-300/80 mt-0.5">
                          当前安装版本为 v{selectedMod.version}。建议去 Nexus Mods 下载最新包覆盖更新，以保证与游戏最新版本的兼容性。
                        </p>
                        <Button 
                          variant="link" 
                          className="text-amber-600 dark:text-amber-400 p-0 h-auto text-[11px] font-bold mt-1.5 hover:underline"
                          onClick={() => {
                            window.open(`https://www.nexusmods.com/stardewvalley/mods/${selectedMod.nexusId}`, '_blank')
                          }}
                        >
                          前往 Nexus Mods 下载页面 &rarr;
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex gap-2">
                    <Button
                      variant={selectedMod.isEnabled ? "destructive" : "default"}
                      size="sm"
                      className="flex-1 gap-1.5 py-2 rounded-xl text-xs font-semibold"
                      onClick={() => handleToggleMod(selectedMod.id)}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {selectedMod.isEnabled ? "禁用此模组" : "启用此模组"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground border-border hover:bg-accent"
                      onClick={() => handleOpenFolder()}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      定位文件夹
                    </Button>
                  </div>
                </TabsContent>

                {/* Tab: Config Form Editor */}
                <TabsContent value="config" className="p-6 space-y-4 outline-none">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">动态参数设置</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        模拟编辑该模组的 <code className="bg-accent/40 px-1 py-0.5 rounded text-[10px]">config.json</code> 参数。
                      </p>
                    </div>
                    {selectedMod.config.length > 0 && (
                      <Button
                        size="sm"
                        className="bg-primary hover:bg-primary/95 text-primary-foreground gap-1.5 rounded-lg text-xs"
                        onClick={handleSaveConfig}
                        disabled={!selectedMod.isEnabled}
                      >
                        <Save className="h-3.5 w-3.5" />
                        保存配置
                      </Button>
                    )}
                  </div>

                  {!selectedMod.isEnabled && (
                    <div className="bg-muted dark:bg-muted/10 border border-border p-3.5 rounded-xl text-center text-xs text-muted-foreground">
                      模组当前处于禁用状态，请在“模组信息”中启用模组后再编辑参数配置。
                    </div>
                  )}

                  <div className="space-y-4 mt-2 max-h-[300px] overflow-y-auto pr-1">
                    {selectedMod.config.length > 0 ? (
                      selectedMod.config.map((field) => (
                        <div
                          key={field.key}
                          className={`p-3 rounded-lg border transition-all ${
                            !selectedMod.isEnabled 
                              ? "opacity-50 border-border bg-accent/10" 
                              : "border-border/60 bg-accent/10 hover:border-primary/30"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-foreground block">
                                {field.label}
                                <span className="text-[10px] text-muted-foreground font-mono ml-2">
                                  ({field.key})
                                </span>
                              </label>
                              <span className="text-[10px] text-muted-foreground leading-normal block">
                                {field.description}
                              </span>
                            </div>

                            {/* Render controls based on type */}
                            <div className="flex-shrink-0 mt-0.5">
                              {field.type === "boolean" && (
                                <div 
                                  onClick={() => {
                                    if(selectedMod.isEnabled) {
                                      handleConfigChange(selectedMod.id, field.key, !field.value)
                                    }
                                  }}
                                >
                                  <button
                                    type="button"
                                    disabled={!selectedMod.isEnabled}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                                      field.value ? "bg-primary" : "bg-muted-foreground/30"
                                    } ${!selectedMod.isEnabled ? "cursor-not-allowed" : ""}`}
                                  >
                                    <span
                                      className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                                        field.value ? "translate-x-4.5" : "translate-x-0.5"
                                      }`}
                                    />
                                  </button>
                                </div>
                              )}

                              {field.type === "number" && (
                                <Input
                                  type="number"
                                  disabled={!selectedMod.isEnabled}
                                  className="w-16 h-8 text-xs text-center border-border bg-card rounded-md"
                                  value={field.value}
                                  onChange={(e) =>
                                    handleConfigChange(
                                      selectedMod.id,
                                      field.key,
                                      parseInt(e.target.value) || 0
                                    )
                                  }
                                />
                              )}

                              {field.type === "string" && (
                                <Input
                                  type="text"
                                  disabled={!selectedMod.isEnabled}
                                  className="w-24 h-8 text-xs border border-border bg-card rounded-md"
                                  value={field.value}
                                  onChange={(e) =>
                                    handleConfigChange(selectedMod.id, field.key, e.target.value)
                                  }
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-6 text-xs text-muted-foreground italic">
                        该模组无需任何自定义参数配置。
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Tab: File View Simulation */}
                <TabsContent value="files" className="p-6 space-y-4 outline-none">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">配置文件模拟器</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      以下是该模组的 <code className="bg-accent/40 px-1 py-0.5 rounded text-[10px]">config.json</code> 在磁盘中的真实序列化状态。
                    </p>
                  </div>

                  <div className="bg-zinc-950 dark:bg-black/90 text-zinc-100 rounded-xl p-4 font-mono text-[11px] leading-relaxed overflow-x-auto border border-zinc-800">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 border-b border-zinc-800 pb-2 mb-2">
                      <span>{selectedMod.localPath}/config.json</span>
                      <span className="text-green-500">JSON Format</span>
                    </div>
                    <pre className="text-emerald-400">
                      {JSON.stringify(
                        selectedMod.config.reduce((acc, field) => {
                          acc[field.key] = field.value
                          return acc
                        }, {} as Record<string, any>),
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </TabsContent>

                {/* Tab: Logs Simulation */}
                <TabsContent value="logs" className="p-6 space-y-4 outline-none">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">SMAPI 启动日志流</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        与此模组相关的加载与生命周期钩子事件监控。
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-green-700/30 text-green-600 bg-green-500/5">
                      正常载入
                    </Badge>
                  </div>

                  <div className="bg-zinc-950 dark:bg-black/90 text-zinc-300 rounded-xl p-4 font-mono text-[10px] leading-normal space-y-1 border border-zinc-800 h-[240px] overflow-y-auto">
                    <p className="text-zinc-500">[06:00:00 INFO  SMAPI] 正在载入模组 {selectedMod.englishName}...</p>
                    <p className="text-zinc-500">[06:00:00 INFO  SMAPI] 读取清单文件 manifest.json...</p>
                    <p className="text-zinc-400">[06:00:01 TRACE SMAPI] 版本: {selectedMod.version} | 作者: {selectedMod.author} | Nexus ID: {selectedMod.nexusId || "无"}</p>
                    {selectedMod.dependencies.length > 0 && (
                      <p className="text-zinc-400">[06:00:01 TRACE SMAPI] 检查依赖项: {selectedMod.dependencies.join(", ")} - 全部就绪</p>
                    )}
                    <p className="text-zinc-500">[06:00:01 INFO  SMAPI] 成功加载模组配置 (config.json)</p>
                    {selectedMod.isEnabled ? (
                      <>
                        <p className="text-green-500">[06:00:01 INFO  SMAPI] 模组 "{selectedMod.name}" 开始初始化钩子...</p>
                        <p className="text-green-400">[06:00:02 INFO  {selectedMod.englishName}] 成功监听了游戏内置更新事件。</p>
                        <p className="text-zinc-500">[06:00:02 INFO  SMAPI] {selectedMod.englishName} 加载成功，耗时 12ms。</p>
                      </>
                    ) : (
                      <>
                        <p className="text-zinc-500">[06:00:01 INFO  SMAPI] 检测到配置已显式禁用该模组 (Enabled=false)</p>
                        <p className="text-amber-500">[06:00:01 WARN  SMAPI] 模组 "{selectedMod.name}" 已跳过加载。</p>
                      </>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </Card>
          ) : (
            <Card className="border border-border p-8 text-center flex flex-col items-center justify-center h-[400px]">
              <Puzzle className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-muted-foreground">请在左侧选择一个模组查看详细信息与配置项</p>
            </Card>
          )}
        </div>
      </div>

      {/* Add Mod Modal Dialog */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <Card className="w-full max-w-lg border border-border shadow-2xl bg-card rounded-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 pb-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Puzzle className="h-5 w-5 text-primary" />
                  导入外部游戏模组
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  手动将非 Nexus 渠道的私有模组或自制模组导入到本地 SMAPI 管理器中。
                </CardDescription>
              </div>
              <button 
                onClick={() => setIsAddModalOpen(false)} 
                className="p-1 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </CardHeader>
            <form onSubmit={handleAddNewMod}>
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground">
                      模组中文名称 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      placeholder="例: 高级洒水器拓展"
                      required
                      value={newModName}
                      onChange={(e) => setNewModName(e.target.value)}
                      className="text-xs h-9 bg-card border-border rounded-lg"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground">
                      英文唯一识别名
                    </label>
                    <Input
                      placeholder="例: AdvancedSprinklers"
                      value={newModEngName}
                      onChange={(e) => setNewModEngName(e.target.value)}
                      className="text-xs h-9 bg-card border-border rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground">
                      原作者署名 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      placeholder="例: FarmerJoe"
                      required
                      value={newModAuthor}
                      onChange={(e) => setNewModAuthor(e.target.value)}
                      className="text-xs h-9 bg-card border-border rounded-lg"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground">
                      初始版本号
                    </label>
                    <Input
                      placeholder="1.0.0"
                      value={newModVersion}
                      onChange={(e) => setNewModVersion(e.target.value)}
                      className="text-xs h-9 bg-card border-border rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    模组类别分类
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {(["core", "content", "utility", "expansion"] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setNewModCategory(cat)}
                        className={`py-2 text-[10px] font-bold border rounded-lg transition-all ${
                          newModCategory === cat
                            ? "bg-primary/10 text-primary border-primary"
                            : "border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {CATEGORY_MAP[cat]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    模组详细描述说明
                  </label>
                  <textarea
                    placeholder="输入该模组的功能介绍，配置项说明等..."
                    rows={3}
                    value={newModDesc}
                    onChange={(e) => setNewModDesc(e.target.value)}
                    className="w-full text-xs p-3 border border-border bg-card rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary resize-none"
                  />
                </div>

                {/* Simulated File upload area */}
                <div className="border-2 border-dashed border-border/80 hover:border-primary/50 rounded-xl p-6 text-center cursor-pointer transition-all bg-accent/10 hover:bg-accent/20">
                  <Download className="h-6 w-6 text-muted-foreground/60 mx-auto mb-2" />
                  <p className="text-xs font-bold text-muted-foreground">拖拽模组压缩包 (.zip) 到这里</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">或点击选择电脑中的 SMAPI 文件夹包进行读取</p>
                </div>
              </CardContent>

              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/60 bg-accent/15">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-lg text-xs hover:bg-accent"
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold rounded-lg text-xs"
                >
                  确认导入
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  )
}
