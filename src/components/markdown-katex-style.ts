import katexCss from "katex/dist/katex.min.css?raw"
import amsRegular from "katex/dist/fonts/KaTeX_AMS-Regular.woff2?url"
import caligraphicBold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?url"
import caligraphicRegular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?url"
import frakturBold from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?url"
import frakturRegular from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?url"
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.woff2?url"
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?url"
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.woff2?url"
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.woff2?url"
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?url"
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff2?url"
import sansSerifBold from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?url"
import sansSerifItalic from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?url"
import sansSerifRegular from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?url"
import scriptRegular from "katex/dist/fonts/KaTeX_Script-Regular.woff2?url"
import size1Regular from "katex/dist/fonts/KaTeX_Size1-Regular.woff2?url"
import size2Regular from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?url"
import size3Regular from "katex/dist/fonts/KaTeX_Size3-Regular.woff2?url"
import size4Regular from "katex/dist/fonts/KaTeX_Size4-Regular.woff2?url"
import typewriterRegular from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?url"

type FontFace = readonly [
  family: string,
  url: string,
  weight: "normal" | "bold",
  style: "normal" | "italic",
]

const fontFaces: FontFace[] = [
  ["KaTeX_AMS", amsRegular, "normal", "normal"],
  ["KaTeX_Caligraphic", caligraphicBold, "bold", "normal"],
  ["KaTeX_Caligraphic", caligraphicRegular, "normal", "normal"],
  ["KaTeX_Fraktur", frakturBold, "bold", "normal"],
  ["KaTeX_Fraktur", frakturRegular, "normal", "normal"],
  ["KaTeX_Main", mainBold, "bold", "normal"],
  ["KaTeX_Main", mainBoldItalic, "bold", "italic"],
  ["KaTeX_Main", mainItalic, "normal", "italic"],
  ["KaTeX_Main", mainRegular, "normal", "normal"],
  ["KaTeX_Math", mathBoldItalic, "bold", "italic"],
  ["KaTeX_Math", mathItalic, "normal", "italic"],
  ["KaTeX_SansSerif", sansSerifBold, "bold", "normal"],
  ["KaTeX_SansSerif", sansSerifItalic, "normal", "italic"],
  ["KaTeX_SansSerif", sansSerifRegular, "normal", "normal"],
  ["KaTeX_Script", scriptRegular, "normal", "normal"],
  ["KaTeX_Size1", size1Regular, "normal", "normal"],
  ["KaTeX_Size2", size2Regular, "normal", "normal"],
  ["KaTeX_Size3", size3Regular, "normal", "normal"],
  ["KaTeX_Size4", size4Regular, "normal", "normal"],
  ["KaTeX_Typewriter", typewriterRegular, "normal", "normal"],
]

const woff2Faces = fontFaces
  .map(
    ([family, url, weight, style]) =>
      `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:${weight};font-style:${style};font-display:block}`
  )
  .join("")

// Importing the package stylesheet with `?raw` keeps Vite from emitting its
// legacy WOFF and TTF fallbacks. The explicit URLs above retain every KaTeX
// face in the modern WOFF2 format while the remaining package CSS stays exact.
const optimizedKatexCss =
  woff2Faces + katexCss.replace(/@font-face\{[^}]*\}/g, "")

if (typeof document !== "undefined") {
  const id = "chat-katex-styles"
  let style = document.getElementById(id) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement("style")
    style.id = id
    document.head.append(style)
  }
  style.textContent = optimizedKatexCss
}
