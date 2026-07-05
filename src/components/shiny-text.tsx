// Adapted from reactbits.dev ShinyText (TS/Tailwind variant)
import { cn } from "@/lib/utils"

export function ShinyText({
  text,
  speed = 4,
  className,
}: {
  text: string
  speed?: number
  className?: string
}) {
  return (
    <span
      className={cn("inline-block bg-clip-text text-transparent", className)}
      style={{
        backgroundImage:
          "linear-gradient(120deg, var(--foreground) 40%, var(--primary) 50%, var(--foreground) 60%)",
        backgroundSize: "200% 100%",
        animation: `shine ${speed}s linear infinite`,
      }}
    >
      {text}
    </span>
  )
}
