import { useState } from 'react'

export interface ClubLogoProps {
  url?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function ClubLogo({
  url,
  size = 'md',
  className = ''
}: ClubLogoProps) {
  const [imgError, setImgError] = useState(false)
  const resolvedUrl = url || (import.meta.env.VITE_CLUB_LOGO_URL as string) || null

  if (resolvedUrl && !imgError) {
    return (
      <img
        src={resolvedUrl}
        alt="Andes Talleres Sport Club"
        className={`club-logo-img logo-${size} ${className}`}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div className={`brand-shield shield-${size} ${className}`} aria-label="Andes Talleres">
      <span>AT</span>
      <small>SC</small>
    </div>
  )
}

export default ClubLogo
