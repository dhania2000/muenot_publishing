import Link from "next/link"
import {Button} from "@/components/ui/button"
import {Badge} from "@/components/ui/badge"
import {EPUB_PROFILES} from "@/lib/epub/intake-plan"
import {conversionHref} from "@/lib/conversion-modules"
import {EpubWorkbench} from "./epub-workbench"

export function EpubOverview({actorScope="fixture"}:{actorScope?:string}){return <div className="space-y-6">
  <section className="rounded-lg border bg-card p-5 space-y-4" aria-labelledby="epub-start">
    <Badge variant="secondary">Project intake ready · conversion planned</Badge>
    <h2 id="epub-start" className="text-xl font-semibold">Plan your next EPUB publication</h2>
    <p className="max-w-3xl text-sm text-muted-foreground">Choose a source, reading layout and book profile. Save a project plan or submit sources privately for intake. Submitted projects are held for security review and engine availability; conversion is not available yet.</p>
    <div className="flex flex-wrap gap-3"><Button asChild><Link href={conversionHref("epub","workspace")}>Plan a publication</Link></Button><Button asChild variant="outline"><Link href={`${conversionHref("epub","workspace")}#epub-inquiry`}>Prepare an enterprise inquiry</Link></Button></div>
    <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Publication planning workflow">{["Choose sources","Book profile","Output settings","Guidelines (optional)","Review plan"].map((s,i)=><li className="rounded border p-3 text-sm" key={s}><span className="font-semibold">{i+1}.</span> {s}</li>)}</ol>
  </section>
  <section className="space-y-3" aria-labelledby="epub-projects"><h2 id="epub-projects" className="text-lg font-semibold">Your EPUB projects</h2><EpubWorkbench key={actorScope} actorScope={actorScope} compact/></section>
  <section aria-labelledby="epub-types" className="space-y-3"><h2 id="epub-types" className="text-lg font-semibold">EPUB types and capabilities</h2><p className="text-sm text-muted-foreground">Planned capabilities are being built. Conditional capabilities also need suitable sources, tools and reader verification. No conversion engine is currently available.</p><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{EPUB_PROFILES.map(p=><article key={p.id} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4"><Badge variant="outline">{p.status}</Badge><h3 className="font-semibold">{p.name}</h3><p className="text-sm">{p.detail}</p><p className="text-xs text-muted-foreground"><strong>Suitable sources:</strong> {p.sources}</p><p className="text-xs text-muted-foreground">{p.limit}</p><Link className="mt-auto text-sm text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2" href={conversionHref("epub",p.page)}>View {p.name.toLowerCase()} requirements</Link></article>)}</div></section>
  <section className="rounded-lg border p-5 space-y-2"><h2 className="font-semibold">Sources and output targets</h2><p className="text-sm text-muted-foreground">Plan for DOCX, PDF, scans, HTML, XML, LaTeX, IDML or authorized EPUB sources. EPUB 3.3 is the baseline target; legacy and experimental profiles have additional restrictions. Choosing a source does not mean its converter is available.</p><p className="text-sm">Client guidelines are optional. When supplied, applicable rules must be reviewed and checked before delivery. Protected content and DRM removal are unsupported.</p></section>
</div>}
