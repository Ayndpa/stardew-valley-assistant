import { useState } from "react"
import { X, ChevronLeft, ChevronRight, ZoomIn } from "lucide-react"

interface ModGalleryProps {
  galleryImages: string[]
  title: string
}

export function ModGallery({ galleryImages, title }: ModGalleryProps) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0)

  if (!galleryImages || galleryImages.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {/* Lightbox Overlay */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center backdrop-blur-sm transition-all"
          onClick={() => setLightboxImage(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
            onClick={() => setLightboxImage(null)}
          >
            <X className="h-5 w-5" />
          </button>
          {galleryImages.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  const newIndex = currentGalleryIndex > 0 ? currentGalleryIndex - 1 : galleryImages.length - 1
                  setCurrentGalleryIndex(newIndex)
                  setLightboxImage(galleryImages[newIndex])
                }}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  const newIndex = currentGalleryIndex < galleryImages.length - 1 ? currentGalleryIndex + 1 : 0
                  setCurrentGalleryIndex(newIndex)
                  setLightboxImage(galleryImages[newIndex])
                }}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <img
            src={lightboxImage}
            alt={title}
            className="w-auto h-auto max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl block"
            onClick={(e) => e.stopPropagation()}
          />
          {galleryImages.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
              {currentGalleryIndex + 1} / {galleryImages.length}
            </div>
          )}
        </div>
      )}

      {/* Main large image */}
      <div
        className="relative w-full h-[34vh] max-h-[320px] rounded-xl overflow-hidden border border-border bg-black/5 cursor-pointer group flex items-center justify-center"
        onClick={() => {
          setLightboxImage(galleryImages[currentGalleryIndex])
        }}
      >
        <img
          src={galleryImages[currentGalleryIndex]}
          alt={title}
          className="w-auto h-auto max-w-full max-h-full object-contain p-2 box-border block transition-transform group-hover:scale-[1.02] mx-auto"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <ZoomIn className="h-8 w-8 text-white/0 group-hover:text-white/70 transition-colors drop-shadow-lg" />
        </div>
        {galleryImages.length > 1 && (
          <>
            <button
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                const newIndex = currentGalleryIndex > 0 ? currentGalleryIndex - 1 : galleryImages.length - 1
                setCurrentGalleryIndex(newIndex)
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                const newIndex = currentGalleryIndex < galleryImages.length - 1 ? currentGalleryIndex + 1 : 0
                setCurrentGalleryIndex(newIndex)
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
              {currentGalleryIndex + 1} / {galleryImages.length}
            </div>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {galleryImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {galleryImages.map((img, index) => (
            <button
              key={index}
              className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                index === currentGalleryIndex
                  ? "border-primary shadow-md"
                  : "border-transparent opacity-60 hover:opacity-100 hover:border-border"
              }`}
              style={{ width: "88px", height: "52px" }}
              onClick={() => setCurrentGalleryIndex(index)}
            >
              <img
                src={img}
                alt={`Screenshot ${index + 1}`}
                className="w-full h-full object-cover block"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
