import React, { useState, useEffect, useRef, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useSavesList } from "@/hooks/useSavesList"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"

import {
  Sun,
  Star,
  Calendar,
  Inbox,
  Plus,
  Trash2,
  X,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Edit2,
  ClipboardList
} from "lucide-react"

// Types
export interface StardewTodoTask {
  id: string
  title: string
  completed: boolean
  important: boolean
  myDay: boolean
  listId: string // "tasks" or custom list ID
  dueDate?: {
    season: "spring" | "summer" | "fall" | "winter" | null
    day: number | null
  }
  notes?: string
  createdAt: number
  completedAt?: number
}

export interface StardewTodoList {
  id: string
  name: string
  createdAt: number
}

interface TodoProps {
  selectedSaveId: string
}


export function Todo({ selectedSaveId }: TodoProps) {
  const { t } = useTranslation()
  const { saves } = useSavesList()

  // Find current save to compute overdue dates
  const currentSave = useMemo(() => {
    return saves.find(s => s.id === selectedSaveId)
  }, [saves, selectedSaveId])

  // Active list ID (can be VirtualListId or custom list ID)
  const [activeListId, setActiveListId] = useState<string>("my-day")

  // State loaded from localStorage
  const [tasks, setTasks] = useState<StardewTodoTask[]>([])
  const [lists, setLists] = useState<StardewTodoList[]>([])

  // UI state
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [newListName, setNewListName] = useState("")
  const [showAddListInput, setShowAddListInput] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [completedExpanded, setCompletedExpanded] = useState(true)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [editingListName, setEditingListName] = useState("")
  const [showListMenuId, setShowListMenuId] = useState<string | null>(null)

  const listMenuRef = useRef<HTMLDivElement>(null)

  // Fetch tasks and custom lists from LocalStorage on mount or when save ID changes
  useEffect(() => {
    const saveKey = selectedSaveId || "global"
    const storedTasks = localStorage.getItem(`stardew-todo-tasks-${saveKey}`)
    const storedLists = localStorage.getItem(`stardew-todo-lists-${saveKey}`)

    if (storedTasks) {
      try {
        setTasks(JSON.parse(storedTasks))
      } catch (e) {
        console.error("Failed to parse stored tasks:", e)
        setTasks([])
      }
    } else {
      setTasks([])
    }

    if (storedLists) {
      try {
        setLists(JSON.parse(storedLists))
      } catch (e) {
        console.error("Failed to parse stored lists:", e)
        setLists([])
      }
    } else {
      setLists([])
    }

    setSelectedTaskId(null)
  }, [selectedSaveId])

  // Save tasks to LocalStorage whenever they change
  const saveTasks = (newTasks: StardewTodoTask[]) => {
    setTasks(newTasks)
    const saveKey = selectedSaveId || "global"
    localStorage.setItem(`stardew-todo-tasks-${saveKey}`, JSON.stringify(newTasks))
  }

  // Save custom lists to LocalStorage whenever they change
  const saveLists = (newLists: StardewTodoList[]) => {
    setLists(newLists)
    const saveKey = selectedSaveId || "global"
    localStorage.setItem(`stardew-todo-lists-${saveKey}`, JSON.stringify(newLists))
  }

  // Handle click outside list menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (listMenuRef.current && !listMenuRef.current.contains(event.target as Node)) {
        setShowListMenuId(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Find active custom list
  const activeCustomList = useMemo(() => {
    return lists.find(l => l.id === activeListId)
  }, [lists, activeListId])

  // Title of the active list
  const activeListTitle = useMemo(() => {
    if (activeListId === "my-day") return t("todo.myDay")
    if (activeListId === "important") return t("todo.important")
    if (activeListId === "planned") return t("todo.planned")
    if (activeListId === "tasks") return t("todo.tasks")
    return activeCustomList?.name || ""
  }, [activeListId, activeCustomList, t])

  // Header Gradient Theme based on list
  const headerGradient = useMemo(() => {
    if (activeListId === "my-day") {
      return "from-orange-500/20 via-rose-500/10 to-transparent border-rose-500/20 dark:from-orange-500/10 dark:via-rose-950/20"
    }
    if (activeListId === "important") {
      return "from-amber-500/20 via-yellow-600/5 to-transparent border-amber-500/20 dark:from-amber-500/10 dark:via-yellow-950/10"
    }
    if (activeListId === "planned") {
      return "from-sky-500/20 via-blue-500/10 to-transparent border-sky-500/20 dark:from-sky-500/10 dark:via-blue-950/20"
    }
    if (activeListId === "tasks") {
      return "from-emerald-500/20 via-teal-500/10 to-transparent border-emerald-500/20 dark:from-emerald-500/10 dark:via-teal-950/20"
    }
    return "from-indigo-500/20 via-purple-500/5 to-transparent border-indigo-500/20 dark:from-indigo-500/10 dark:via-purple-950/10"
  }, [activeListId])

  // Date utilities for Stardew Valley
  const seasonsMap = ["spring", "summer", "fall", "winter"]
  
  // Calculate due date status
  const getDueDateStatus = (dueDate?: StardewTodoTask["dueDate"]) => {
    if (!dueDate || !dueDate.season || !dueDate.day) return null

    // If no save file selected, just show the date text
    if (!currentSave) {
      return {
        text: t("todo.dueOn", { season: t(`seasons.${dueDate.season}`), day: dueDate.day }),
        isOverdue: false,
        daysText: ""
      }
    }

    const currentSeasonIdx = currentSave.season // 0: Spring, 1: Summer, 2: Fall, 3: Winter
    const currentDay = currentSave.dayOfMonth
    
    const targetSeasonIdx = seasonsMap.indexOf(dueDate.season)
    const targetDay = dueDate.day

    const currentTotalDays = currentSeasonIdx * 28 + currentDay
    const targetTotalDays = targetSeasonIdx * 28 + targetDay

    const diff = targetTotalDays - currentTotalDays
    const formattedDate = t("todo.dueOn", { season: t(`seasons.${dueDate.season}`), day: dueDate.day })

    if (diff === 0) {
      return {
        text: formattedDate,
        isOverdue: false,
        daysText: t("todo.dueToday"),
        theme: "text-amber-500 font-medium"
      }
    } else if (diff === 1) {
      return {
        text: formattedDate,
        isOverdue: false,
        daysText: t("todo.dueTomorrow"),
        theme: "text-primary/80 font-medium"
      }
    } else if (diff > 0) {
      return {
        text: formattedDate,
        isOverdue: false,
        daysText: t("todo.daysRemaining", { count: diff }),
        theme: "text-muted-foreground"
      }
    } else {
      // Overdue in current year
      const overdueDays = Math.abs(diff)
      return {
        text: formattedDate,
        isOverdue: true,
        daysText: t("todo.daysOverdue", { count: overdueDays }),
        theme: "text-destructive font-semibold"
      }
    }
  }

  // Filter tasks for active view
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (activeListId === "my-day") return task.myDay
      if (activeListId === "important") return task.important
      if (activeListId === "planned") return !!(task.dueDate && task.dueDate.season && task.dueDate.day)
      if (activeListId === "tasks") return task.listId === "tasks"
      return task.listId === activeListId
    })
  }, [tasks, activeListId])

  // Separate active and completed tasks
  const { activeTasks, completedTasks } = useMemo(() => {
    return {
      activeTasks: filteredTasks.filter(t => !t.completed),
      completedTasks: filteredTasks.filter(t => t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    }
  }, [filteredTasks])

  // Count active tasks for badge counts
  const listCounts = useMemo(() => {
    const counts: Record<string, number> = {
      "my-day": tasks.filter(t => t.myDay && !t.completed).length,
      "important": tasks.filter(t => t.important && !t.completed).length,
      "planned": tasks.filter(t => t.dueDate && t.dueDate.season && t.dueDate.day && !t.completed).length,
      "tasks": tasks.filter(t => t.listId === "tasks" && !t.completed).length,
    }
    lists.forEach(l => {
      counts[l.id] = tasks.filter(t => t.listId === l.id && !t.completed).length
    })
    return counts
  }, [tasks, lists])

  // Add a new task
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTaskTitle.trim()) return

    const newTask: StardewTodoTask = {
      id: crypto.randomUUID(),
      title: newTaskTitle.trim(),
      completed: false,
      important: activeListId === "important",
      myDay: activeListId === "my-day",
      listId: (activeListId === "my-day" || activeListId === "important" || activeListId === "planned") ? "tasks" : activeListId,
      createdAt: Date.now()
    }

    saveTasks([...tasks, newTask])
    setNewTaskTitle("")
  }

  // Toggle task completion
  const handleToggleComplete = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newTasks = tasks.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          completed: !t.completed,
          completedAt: !t.completed ? Date.now() : undefined
        }
      }
      return t
    })
    saveTasks(newTasks)
  }

  // Toggle task importance
  const handleToggleImportant = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newTasks = tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, important: !t.important }
      }
      return t
    })
    saveTasks(newTasks)
  }

  // Add task to My Day
  const handleToggleMyDay = (taskId: string) => {
    const newTasks = tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, myDay: !t.myDay }
      }
      return t
    })
    saveTasks(newTasks)
  }

  // Delete task
  const handleDeleteTask = (taskId: string) => {
    const newTasks = tasks.filter(t => t.id !== taskId)
    saveTasks(newTasks)
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null)
    }
  }

  // Edit task details
  const handleUpdateTaskDetail = (taskId: string, fields: Partial<StardewTodoTask>) => {
    const newTasks = tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, ...fields }
      }
      return t
    })
    saveTasks(newTasks)
  }

  // Add custom list
  const handleAddList = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newListName.trim()) return

    const newList: StardewTodoList = {
      id: crypto.randomUUID(),
      name: newListName.trim(),
      createdAt: Date.now()
    }

    saveLists([...lists, newList])
    setNewListName("")
    setShowAddListInput(false)
    setActiveListId(newList.id)
  }

  // Delete custom list
  const handleDeleteList = (listId: string) => {
    if (confirm(t("todo.deleteListConfirm"))) {
      const newLists = lists.filter(l => l.id !== listId)
      saveLists(newLists)
      // Delete tasks inside this list
      const newTasks = tasks.filter(t => t.listId !== listId)
      saveTasks(newTasks)

      if (activeListId === listId) {
        setActiveListId("my-day")
      }
      setShowListMenuId(null)
    }
  }

  // Rename custom list
  const handleRenameList = (listId: string) => {
    const target = lists.find(l => l.id === listId)
    if (target) {
      setEditingListId(listId)
      setEditingListName(target.name)
    }
    setShowListMenuId(null)
  }

  // Save renamed list
  const handleSaveRename = (listId: string) => {
    if (!editingListName.trim()) return
    const newLists = lists.map(l => {
      if (l.id === listId) {
        return { ...l, name: editingListName.trim() }
      }
      return l
    })
    saveLists(newLists)
    setEditingListId(null)
  }

  // Selected task detail object
  const selectedTask = useMemo(() => {
    return tasks.find(t => t.id === selectedTaskId)
  }, [tasks, selectedTaskId])

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground select-none relative">
      
      {/* 1. Left Sidebar for Notes Navigation */}
      <div className="w-64 border-r border-border/60 bg-card flex flex-col h-full shrink-0">
        
        {/* Navigation list */}
        <ScrollArea className="flex-1 px-3 py-4">
          <div className="space-y-1">
            
            {/* My Day */}
            <button
              onClick={() => setActiveListId("my-day")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeListId === "my-day"
                  ? "bg-orange-500/10 text-orange-600 dark:bg-orange-950/20 dark:text-orange-400"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Sun className="h-4 w-4" />
                <span>{t("todo.myDay")}</span>
              </div>
              {listCounts["my-day"] > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400">
                  {listCounts["my-day"]}
                </span>
              )}
            </button>

            {/* Important */}
            <button
              onClick={() => setActiveListId("important")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeListId === "important"
                  ? "bg-amber-500/10 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Star className="h-4 w-4" />
                <span>{t("todo.important")}</span>
              </div>
              {listCounts["important"] > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  {listCounts["important"]}
                </span>
              )}
            </button>

            {/* Planned */}
            <button
              onClick={() => setActiveListId("planned")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeListId === "planned"
                  ? "bg-sky-500/10 text-sky-600 dark:bg-sky-950/20 dark:text-sky-400"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Calendar className="h-4 w-4" />
                <span>{t("todo.planned")}</span>
              </div>
              {listCounts["planned"] > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400">
                  {listCounts["planned"]}
                </span>
              )}
            </button>

            {/* General Tasks */}
            <button
              onClick={() => setActiveListId("tasks")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeListId === "tasks"
                  ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Inbox className="h-4 w-4" />
                <span>{t("todo.tasks")}</span>
              </div>
              {listCounts["tasks"] > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                  {listCounts["tasks"]}
                </span>
              )}
            </button>

          </div>

          {/* Custom Lists Separator */}
          <div className="py-2.5">
            <div className="border-t border-border/40" />
          </div>

          {/* Custom Lists Group */}
          <div className="space-y-1">
            {lists.map(list => (
              <div
                key={list.id}
                onClick={() => setActiveListId(list.id)}
                className={`group/item w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                  activeListId === list.id
                    ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                {editingListId === list.id ? (
                  <input
                    type="text"
                    value={editingListName}
                    onChange={(e) => setEditingListName(e.target.value)}
                    onBlur={() => handleSaveRename(list.id)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveRename(list.id)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="bg-background border border-border/80 px-2 py-0.5 rounded text-xs text-foreground focus:outline-none w-full max-w-[140px]"
                  />
                ) : (
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <ClipboardList className="h-4 w-4 shrink-0" />
                    <span className="truncate">{list.name}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {listCounts[list.id] > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary dark:bg-primary/30 dark:text-primary">
                      {listCounts[list.id]}
                    </span>
                  )}
                  
                  {/* Action Menu Trigger */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowListMenuId(showListMenuId === list.id ? null : list.id)
                      }}
                      className="opacity-0 group-hover/item:opacity-100 p-0.5 hover:bg-accent hover:text-foreground rounded transition-opacity"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>

                    {showListMenuId === list.id && (
                      <div
                        ref={listMenuRef}
                        className="absolute right-0 mt-1 bg-popover border border-border shadow-md rounded-lg py-1 z-50 text-xs w-28 text-foreground"
                      >
                        <button
                          onClick={() => handleRenameList(list.id)}
                          className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-1.5"
                        >
                          <Edit2 className="h-3 w-3" />
                          {t("todo.renameList")}
                        </button>
                        <button
                          onClick={() => handleDeleteList(list.id)}
                          className="w-full text-left px-3 py-1.5 hover:bg-accent text-destructive hover:text-destructive flex items-center gap-1.5"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t("todo.deleteList")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Add list section */}
        <div className="p-3 border-t border-border/40 shrink-0">
          {showAddListInput ? (
            <form onSubmit={handleAddList} className="flex gap-1.5">
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder={t("todo.newListPlaceholder")}
                className="flex-1 bg-background border border-border text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground"
                autoFocus
              />
              <Button type="submit" size="sm" className="h-8 shrink-0 px-2.5">
                <Plus className="h-4 w-4" />
              </Button>
              <button
                type="button"
                onClick={() => setShowAddListInput(false)}
                className="p-1.5 hover:bg-accent rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <button
              onClick={() => setShowAddListInput(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 rounded-lg transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>{t("todo.addList")}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Middle panel (Main list) */}
      <div className="flex-1 flex flex-col h-full bg-accent/5">
        
        {/* Custom Header banner */}
        <div className={`p-6 border-b shrink-0 bg-gradient-to-r ${headerGradient} transition-all duration-300`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">{activeListTitle}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{t("todo.description")}</p>
            </div>
            {/* Show alert if no save selected */}
            {!selectedSaveId && (
              <div className="rounded-full bg-muted border border-border px-3 py-1 text-[10px] text-muted-foreground font-medium flex items-center gap-1.5 max-w-[260px] truncate" title={t("todo.saveRequired")}>
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="truncate">{t("todo.saveRequired")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Input box for new task */}
        <div className="px-6 py-4 shrink-0">
          <form onSubmit={handleAddTask} className="flex gap-3 bg-card border border-border/80 rounded-xl px-4 py-2 shadow-sm focus-within:ring-1 focus-within:ring-primary/50 transition-all">
            <button
              type="submit"
              className="shrink-0 text-muted-foreground hover:text-primary flex items-center justify-center p-1"
            >
              <Plus className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder={t("todo.addTaskPlaceholder")}
              className="flex-1 bg-transparent border-none text-sm text-foreground focus:outline-none placeholder-muted-foreground/60"
            />
          </form>
        </div>

        {/* Task list container */}
        <ScrollArea className="flex-1 px-6 pb-6">
          <div className="space-y-4">
            
            {/* Active Tasks list */}
            {activeTasks.length > 0 ? (
              <div className="space-y-1.5">
                {activeTasks.map(task => {
                  const isSelected = selectedTaskId === task.id
                  const dateInfo = getDueDateStatus(task.dueDate)
                  
                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-primary/5 border-primary shadow-sm"
                          : "bg-card border-border/50 hover:border-border/90 hover:shadow-sm"
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={(e) => handleToggleComplete(task.id, e)}
                        className="group h-[22px] w-[22px] rounded-full border border-border/80 flex items-center justify-center hover:border-primary hover:bg-primary/5 dark:hover:bg-primary/10 shrink-0 transition-all cursor-pointer bg-background active:scale-90"
                        title={t("todo.taskCompleted")}
                      >
                        <Check className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity stroke-[3]" />
                      </button>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                        
                        {/* Task badges */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[10px] text-muted-foreground">
                          {/* Parent List badge if not in the list view */}
                          {(activeListId === "my-day" || activeListId === "important" || activeListId === "planned") && (
                            <span className="bg-accent px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider">
                              {task.listId === "tasks" ? t("todo.tasks") : lists.find(l => l.id === task.listId)?.name || t("todo.tasks")}
                            </span>
                          )}
                          
                          {/* Due Date badge */}
                          {dateInfo && (
                            <div className={`flex items-center gap-1 ${dateInfo.theme}`}>
                              <Calendar className="h-3 w-3 shrink-0" />
                              <span>{dateInfo.text}</span>
                              {dateInfo.daysText && (
                                <span className="opacity-80">({dateInfo.daysText})</span>
                              )}
                            </div>
                          )}

                          {/* Notes preview marker */}
                          {task.notes && (
                            <span className="text-muted-foreground/80 leading-none truncate max-w-[200px]">
                              · {task.notes}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Star Button */}
                      <button
                        onClick={(e) => handleToggleImportant(task.id, e)}
                        className="shrink-0 p-1 hover:bg-accent rounded-lg text-muted-foreground transition-colors"
                      >
                        <Star className={`h-4 w-4 transition-colors ${task.important ? "fill-amber-500 text-amber-500" : "hover:text-amber-500"}`} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {/* Completed Tasks (collapsible) */}
            {completedTasks.length > 0 && (
              <div className="space-y-2 mt-4">
                <button
                  onClick={() => setCompletedExpanded(!completedExpanded)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground py-1 px-1 transition-colors"
                >
                  {completedExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <span>{t("todo.completed")} ({completedTasks.length})</span>
                </button>

                {completedExpanded && (
                  <div className="space-y-1.5">
                    {completedTasks.map(task => {
                      const isSelected = selectedTaskId === task.id
                      const dateInfo = getDueDateStatus(task.dueDate)

                      return (
                        <div
                          key={task.id}
                          onClick={() => setSelectedTaskId(task.id)}
                          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all cursor-pointer opacity-70 hover:opacity-100 ${
                            isSelected
                              ? "bg-primary/5 border-primary/50"
                              : "bg-card/60 border-border/30 hover:border-border/70"
                          }`}
                        >
                          {/* Completed Checkbox */}
                          <button
                            onClick={(e) => handleToggleComplete(task.id, e)}
                            className="h-[22px] w-[22px] rounded-full border border-primary bg-primary text-primary-foreground flex items-center justify-center shrink-0 transition-all cursor-pointer active:scale-90"
                            title={t("todo.taskActive")}
                          >
                            <Check className="h-3.5 w-3.5 text-primary-foreground stroke-[3]" />
                          </button>

                          {/* Completed Title (strikethrough) */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-muted-foreground line-through truncate">{task.title}</p>
                            
                            {/* Badges */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-[10px] text-muted-foreground/60">
                              {(activeListId === "my-day" || activeListId === "important" || activeListId === "planned") && (
                                <span className="bg-accent/50 px-1.5 py-0.5 rounded text-[8px] font-semibold">
                                  {task.listId === "tasks" ? t("todo.tasks") : lists.find(l => l.id === task.listId)?.name || t("todo.tasks")}
                                </span>
                              )}
                              {dateInfo && (
                                <div className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3 shrink-0" />
                                  <span>{dateInfo.text}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Star Button */}
                          <button
                            onClick={(e) => handleToggleImportant(task.id, e)}
                            className="shrink-0 p-1 hover:bg-accent rounded-lg text-muted-foreground/50 transition-colors"
                          >
                            <Star className={`h-4 w-4 ${task.important ? "fill-amber-500/55 text-amber-500/55" : ""}`} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Empty State */}
            {activeTasks.length === 0 && completedTasks.length === 0 && (
              <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-accent/20 flex items-center justify-center text-muted-foreground/40">
                  <ClipboardList className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground">{t("collections.allComplete")}</h4>
                  <p className="text-xs text-muted-foreground/60 mt-1">今天没有什么计划，去和村民聊聊或者去挖个矿吧！</p>
                </div>
              </div>
            )}

          </div>
        </ScrollArea>
      </div>

      {/* 3. Right panel (Task detail drawer/sidebar) */}
      {selectedTask && (
        <div className="w-80 border-l border-border/80 bg-card h-full flex flex-col shadow-xl z-20 animate-in slide-in-from-right duration-200 shrink-0">
          
          {/* Header */}
          <div className="p-4 border-b border-border/40 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">{t("todo.taskDetailTitle")}</h3>
            <button
              onClick={() => setSelectedTaskId(null)}
              className="p-1 hover:bg-accent rounded-lg transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <ScrollArea className="flex-1 p-4 space-y-5">
            <div className="space-y-4">
              
              {/* Task Title Edit */}
              <div className="space-y-1">
                <input
                  type="text"
                  value={selectedTask.title}
                  onChange={(e) => handleUpdateTaskDetail(selectedTask.id, { title: e.target.value })}
                  className="w-full bg-transparent border-none text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 px-2 py-1 rounded"
                />
              </div>

              {/* Add to My Day toggle */}
              <button
                onClick={() => handleToggleMyDay(selectedTask.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                  selectedTask.myDay
                    ? "bg-orange-500/10 border-orange-500/30 text-orange-600 dark:bg-orange-950/20 dark:text-orange-400"
                    : "bg-background border-border/50 hover:bg-accent/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sun className="h-4 w-4 shrink-0" />
                <span>{selectedTask.myDay ? t("todo.removeFromMyDay") : t("todo.addToMyDay")}</span>
              </button>

              {/* List Placement Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                  {t("todo.tasks")}
                </label>
                <select
                  value={selectedTask.listId}
                  onChange={(e) => handleUpdateTaskDetail(selectedTask.id, { listId: e.target.value })}
                  className="w-full bg-background border border-border text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground"
                >
                  <option value="tasks">{t("todo.tasks")}</option>
                  {lists.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              {/* Stardew Calendar Due Date Select */}
              <div className="space-y-2 border border-border/50 rounded-xl p-3.5 bg-accent/15">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    <span>{t("todo.dueDate")}</span>
                  </label>
                  {selectedTask.dueDate?.season && selectedTask.dueDate?.day && (
                    <button
                      onClick={() => handleUpdateTaskDetail(selectedTask.id, { dueDate: undefined })}
                      className="text-[10px] text-destructive hover:underline"
                    >
                      清除
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  {/* Season Select */}
                  <select
                    value={selectedTask.dueDate?.season || ""}
                    onChange={(e) => {
                      const season = e.target.value as "spring" | "summer" | "fall" | "winter" || null
                      const day = selectedTask.dueDate?.day || 1
                      handleUpdateTaskDetail(selectedTask.id, {
                        dueDate: season ? { season, day } : undefined
                      })
                    }}
                    className="bg-background border border-border text-xs rounded-lg px-2 py-1.5 focus:outline-none text-foreground"
                  >
                    <option value="">{t("todo.selectSeason")}</option>
                    <option value="spring">{t("seasons.spring")}</option>
                    <option value="summer">{t("seasons.summer")}</option>
                    <option value="fall">{t("seasons.fall")}</option>
                    <option value="winter">{t("seasons.winter")}</option>
                  </select>

                  {/* Day Select */}
                  <select
                    value={selectedTask.dueDate?.day || ""}
                    onChange={(e) => {
                      const day = e.target.value ? parseInt(e.target.value) : null
                      const season = selectedTask.dueDate?.season || "spring"
                      handleUpdateTaskDetail(selectedTask.id, {
                        dueDate: day ? { season, day } : undefined
                      })
                    }}
                    className="bg-background border border-border text-xs rounded-lg px-2 py-1.5 focus:outline-none text-foreground"
                    disabled={!selectedTask.dueDate?.season}
                  >
                    <option value="">{t("todo.selectDay")}</option>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d} 日</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Multi-line notes */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                  备注
                </label>
                <textarea
                  value={selectedTask.notes || ""}
                  onChange={(e) => handleUpdateTaskDetail(selectedTask.id, { notes: e.target.value })}
                  placeholder={t("todo.notesPlaceholder")}
                  rows={6}
                  className="w-full bg-background border border-border text-xs rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground placeholder-muted-foreground/60 resize-none"
                />
              </div>

            </div>
          </ScrollArea>

          {/* Footer containing delete and creation date */}
          <div className="p-4 border-t border-border/40 bg-accent/15 flex items-center justify-between shrink-0">
            <span className="text-[10px] text-muted-foreground">
              创建于 {new Date(selectedTask.createdAt).toLocaleDateString()}
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleDeleteTask(selectedTask.id)}
              className="h-8 flex items-center gap-1.5 px-3 rounded-lg"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t("todo.deleteTask")}</span>
            </Button>
          </div>

        </div>
      )}

    </div>
  )
}
