import { useRef } from "react"
import { ImageIcon, Upload, Link, AlertCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

// ─── Config shape ────────────────────────────────────────────────────────────

interface ImageWidgetConfig {
  /** Data-URL (for local file uploads) or remote URL */
  src?: string
  /** Display title shown at the bottom of the widget */
  title?: string
  /** CSS object-fit value */
  objectFit?: "cover" | "contain" | "fill"
  /** Show the title overlay */
  showTitle?: boolean
  /** Border radius preset */
  borderRadius?: "none" | "sm" | "md" | "lg"
}

const BORDER_RADIUS_MAP: Record<string, string> = {
  none: "rounded-none",
  sm:   "rounded-sm",
  md:   "rounded-md",
  lg:   "rounded-xl",
}

// ─── Display widget ───────────────────────────────────────────────────────────

function CustomImageContent({ config }: WidgetRenderProps) {
  const { t } = useTranslation()
  const cfg = config as ImageWidgetConfig
  const { src, title, objectFit = "cover", showTitle = true, borderRadius = "md" } = cfg

  const radiusClass = BORDER_RADIUS_MAP[borderRadius] ?? "rounded-md"
  const fitClass =
    objectFit === "contain" ? "object-contain" :
    objectFit === "fill"    ? "object-fill"    :
                              "object-cover"

  if (!src) {
    return (
      <Card className="h-full border-dashed">
        <CardContent className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <ImageIcon className="h-6 w-6 text-primary/60" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground/80">
              {t("dashboard.widgetPicker.customImage.empty.title")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("dashboard.widgetPicker.customImage.empty.hint")}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={`relative h-full w-full overflow-hidden ${radiusClass} group`}>
      <img
        src={src}
        alt={title || ""}
        className={`h-full w-full ${fitClass} transition-transform duration-500 group-hover:scale-[1.02]`}
        draggable={false}
      />
      {showTitle && title && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
          <p className="text-white text-sm font-semibold drop-shadow truncate">{title}</p>
        </div>
      )}
    </div>
  )
}

// ─── Config / settings panel ──────────────────────────────────────────────────

function CustomImageConfigPanel({ config, onConfigChange }: WidgetRenderProps) {
  const { t } = useTranslation()
  const cfg = config as ImageWidgetConfig
  const { src, title = "", objectFit = "cover", showTitle = true, borderRadius = "md" } = cfg

  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    onConfigChange({ src: e.target.value.trim() })
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      onConfigChange({ src: dataUrl })
    }
    reader.readAsDataURL(file)
  }

  const objectFitOptions: { value: ImageWidgetConfig["objectFit"]; label: string }[] = [
    { value: "cover",   label: t("dashboard.widgetPicker.customImage.config.fitCover") },
    { value: "contain", label: t("dashboard.widgetPicker.customImage.config.fitContain") },
    { value: "fill",    label: t("dashboard.widgetPicker.customImage.config.fitFill") },
  ]

  const borderRadiusOptions: { value: ImageWidgetConfig["borderRadius"]; label: string }[] = [
    { value: "none", label: t("dashboard.widgetPicker.customImage.config.radiusNone") },
    { value: "sm",   label: t("dashboard.widgetPicker.customImage.config.radiusSm") },
    { value: "md",   label: t("dashboard.widgetPicker.customImage.config.radiusMd") },
    { value: "lg",   label: t("dashboard.widgetPicker.customImage.config.radiusLg") },
  ]

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5 pb-3 border-b border-border">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ImageIcon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-bold">{t("dashboard.widgetPicker.customImage.config.title")}</p>
          <p className="text-xs text-muted-foreground">{t("dashboard.widgetPicker.customImage.config.subtitle")}</p>
        </div>
      </div>

      {/* Image source */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("dashboard.widgetPicker.customImage.config.sourceLabel")}
        </label>

        {/* Current preview */}
        {src && (
          <div className="relative rounded-lg overflow-hidden h-28 bg-muted/40 border border-border">
            <img
              src={src}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => { (e.currentTarget.parentElement as HTMLDivElement).style.display = "none" }}
            />
          </div>
        )}

        {/* URL input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 text-sm h-8"
              placeholder={t("dashboard.widgetPicker.customImage.config.urlPlaceholder")}
              defaultValue={src?.startsWith("data:") ? "" : (src ?? "")}
              onChange={handleUrlChange}
            />
          </div>
        </div>

        {/* File upload */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {t("dashboard.widgetPicker.customImage.config.uploadButton")}
          </Button>
          {src?.startsWith("data:") && (
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {t("dashboard.widgetPicker.customImage.config.localFileNote")}
            </p>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("dashboard.widgetPicker.customImage.config.captionLabel")}
        </label>
        <Input
          className="text-sm h-8"
          placeholder={t("dashboard.widgetPicker.customImage.config.captionPlaceholder")}
          value={title}
          onChange={(e) => onConfigChange({ title: e.target.value })}
        />
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-primary"
            checked={showTitle}
            onChange={(e) => onConfigChange({ showTitle: e.target.checked })}
          />
          <span className="text-xs text-muted-foreground">
            {t("dashboard.widgetPicker.customImage.config.showCaption")}
          </span>
        </label>
      </div>

      {/* Object fit */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("dashboard.widgetPicker.customImage.config.fitLabel")}
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {objectFitOptions.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onConfigChange({ objectFit: value })}
              className={`text-xs py-1.5 px-2 rounded-lg border font-medium transition-colors ${
                objectFit === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/30 hover:bg-muted/70 border-border"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Border radius */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("dashboard.widgetPicker.customImage.config.radiusLabel")}
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {borderRadiusOptions.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onConfigChange({ borderRadius: value })}
              className={`text-xs py-1.5 px-1 rounded-lg border font-medium transition-colors ${
                borderRadius === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/30 hover:bg-muted/70 border-border"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Registration ─────────────────────────────────────────────────────────────

registerWidget({
  id: "custom-image",
  nameKey: "dashboard.widgetPicker.customImage.name",
  descriptionKey: "dashboard.widgetPicker.customImage.description",
  icon: ImageIcon,
  defaultSize: "medium",
  category: "media",
  render: (props) => <CustomImageContent {...props} />,
  renderConfig: (props) => <CustomImageConfigPanel {...props} />,
})
