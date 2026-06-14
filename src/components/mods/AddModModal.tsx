import { useTranslation } from "react-i18next"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Puzzle, X, Download } from "lucide-react"

interface AddModModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  name: string
  setName: (val: string) => void
  engName: string
  setEngName: (val: string) => void
  author: string
  setAuthor: (val: string) => void
  desc: string
  setDesc: (val: string) => void
  category: "core" | "content" | "utility" | "expansion"
  setCategory: (val: "core" | "content" | "utility" | "expansion") => void
  version: string
  setVersion: (val: string) => void
  categoryMap: Record<string, string>
}

export function AddModModal({
  isOpen,
  onClose,
  onSubmit,
  name,
  setName,
  engName,
  setEngName,
  author,
  setAuthor,
  desc,
  setDesc,
  category,
  setCategory,
  version,
  setVersion,
  categoryMap,
}: AddModModalProps) {
  const { t } = useTranslation()
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <Card className="w-full max-w-lg border border-border shadow-2xl bg-card rounded-xl overflow-hidden animate-in zoom-in-95 duration-200">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 pb-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Puzzle className="h-5 w-5 text-primary" />
              {t("mods.addMod.title")}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {t("mods.addMod.description")}
            </CardDescription>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  {t("mods.addMod.nameLabel")} <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder={t("mods.addMod.namePlaceholder")}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-xs h-9 bg-card border-border rounded-lg"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  {t("mods.addMod.engNameLabel")}
                </label>
                <Input
                  placeholder={t("mods.addMod.engNamePlaceholder")}
                  value={engName}
                  onChange={(e) => setEngName(e.target.value)}
                  className="text-xs h-9 bg-card border-border rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  {t("mods.addMod.authorLabel")} <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder={t("mods.addMod.authorPlaceholder")}
                  required
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="text-xs h-9 bg-card border-border rounded-lg"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  {t("mods.addMod.versionLabel")}
                </label>
                <Input
                  placeholder="1.0.0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="text-xs h-9 bg-card border-border rounded-lg"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">
                {t("mods.addMod.categoryLabel")}
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(["core", "content", "utility", "expansion"] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`py-2 text-[10px] font-bold border rounded-lg transition-all ${
                      category === cat
                        ? "bg-primary/10 text-primary border-primary"
                        : "border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {categoryMap[cat]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">
                {t("mods.addMod.descLabel")}
              </label>
              <textarea
                placeholder={t("mods.addMod.descPlaceholder")}
                rows={3}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full text-xs p-3 border border-border bg-card rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary resize-none"
              />
            </div>

            {/* Simulated File upload area */}
            <div className="border-2 border-dashed border-border/80 hover:border-primary/50 rounded-xl p-6 text-center cursor-pointer transition-all bg-accent/10 hover:bg-accent/20">
              <Download className="h-6 w-6 text-muted-foreground/60 mx-auto mb-2" />
              <p className="text-xs font-bold text-muted-foreground">{t("mods.addMod.dropZoneTitle")}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">{t("mods.addMod.dropZoneDesc")}</p>
            </div>
          </CardContent>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/60 bg-accent/15">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="rounded-lg text-xs hover:bg-accent"
            >
              {t("mods.addMod.cancel")}
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold rounded-lg text-xs"
            >
              {t("mods.addMod.confirmImport")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
