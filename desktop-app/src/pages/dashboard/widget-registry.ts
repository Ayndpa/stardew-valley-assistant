import type { WidgetDefinition } from "./types"

const registry = new Map<string, WidgetDefinition>()

export function registerWidget(definition: WidgetDefinition): void {
  if (registry.has(definition.id)) {
    console.warn(`Widget "${definition.id}" is already registered`)
    return
  }
  registry.set(definition.id, definition)
}

export function getWidget(id: string): WidgetDefinition | undefined {
  return registry.get(id)
}

export function getAllWidgets(): WidgetDefinition[] {
  return Array.from(registry.values())
}

export function getWidgetsByCategory(
  category: WidgetDefinition["category"],
): WidgetDefinition[] {
  return Array.from(registry.values()).filter((w) => w.category === category)
}
