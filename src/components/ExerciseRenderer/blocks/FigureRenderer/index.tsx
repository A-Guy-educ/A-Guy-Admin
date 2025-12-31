import React, { useEffect, useState } from 'react'
import type { FigureBlock } from '@/contracts'

// Helper to fetch asset data
const useAsset = (assetId: string) => {
  const [asset, setAsset] = useState<{ url?: string; alt?: string; caption?: any } | null>(null)

  useEffect(() => {
    const fetchAsset = async () => {
      try {
        const response = await fetch(`/api/exercise-assets/${assetId}`)
        if (response.ok) {
          const data = await response.json()
          setAsset(data)
        }
      } catch (e) {
        console.error('Failed to load asset', e)
      }
    }
    fetchAsset()
  }, [assetId])

  return asset
}

export const FigureRenderer: React.FC<{
  block: FigureBlock
  availableAssets?: Record<string, string>
}> = ({ block, availableAssets }) => {
  // If we have the URL from the availableAssets map (server-side / pre-fetched), use it.
  // Otherwise, fall back to the client-side hook.
  const assetUrl = availableAssets?.[block.assetId]
  const fetchedAsset = useAsset(assetUrl ? '' : block.assetId)

  // Use either the direct URL or the fetched asset
  const finalUrl = assetUrl || fetchedAsset?.url
  const finalAlt = block.alt || fetchedAsset?.alt || 'Exercise Image'
  const finalCaption = block.caption

  if (!finalUrl) {
    if (assetUrl) return null // Should not happen if map is correct
    return <div className="p-4 bg-gray-100 rounded animate-pulse w-full h-48" />
  }

  return (
    <figure className="my-4 flex flex-col items-center">
      <img
        src={finalUrl}
        alt={finalAlt}
        className="max-w-full h-auto rounded border border-gray-200 shadow-sm"
      />
      {finalCaption && (
        <figcaption className="mt-2 text-sm text-gray-500 text-center">{finalCaption}</figcaption>
      )}
    </figure>
  )
}
