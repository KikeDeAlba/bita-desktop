import type { PageNode, PageSearchHit, PageSearchMatch, TranscriptHit, TranscriptMatch } from '../bita.ts'

export type SearchScope = 'space' | 'all'

export interface PageResult {
  pageId: number
  title: string
  projectId: number | null
  projectName: string | null
  projectSlug: string
  crumb: string
  matchCount: number
  page: number
  entries: number
  transcript: number
  snippet: { prefix: string; match: string; suffix: string } | null
  matches: PageSearchMatch[]
  transcriptMatches: TranscriptMatch[]
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ')
}

export function fromPageHit(hit: PageSearchHit): PageResult {
  const first = hit.matches.find((match) => match.section !== null && !/^[\w-]+:\s/.test(match.prefix.trimStart())) ?? hit.matches[0]
  return {
    pageId: hit.pageId,
    title: hit.title,
    projectId: hit.projectId,
    projectName: hit.projectName,
    projectSlug: hit.projectSlug,
    crumb: hit.ancestors.length > 0 ? hit.ancestors.map((ancestor) => ancestor.title).join(' / ') : 'Raíz del espacio',
    matchCount: hit.matchCount,
    page: hit.sources.page,
    entries: hit.sources.entries,
    transcript: 0,
    snippet: first === undefined ? null : { prefix: squash(first.prefix), match: first.match, suffix: squash(first.suffix) },
    matches: hit.matches,
    transcriptMatches: [],
  }
}

export function withTranscripts(
  results: PageResult[],
  hits: TranscriptHit[],
  pages: PageNode[],
  crumbOf: (page: PageNode) => string,
): PageResult[] {
  const byEntry = new Map<number, PageNode>()
  for (const page of pages) {
    for (const meeting of page.meetings ?? []) byEntry.set(meeting.entryId, page)
  }
  const merged = new Map(results.map((result) => [result.pageId, { ...result }]))
  for (const hit of hits) {
    const page = byEntry.get(hit.entryId)
    if (page === undefined || hit.matchCount === 0) continue
    let target = merged.get(page.pageId)
    if (target === undefined) {
      const first = hit.matches[0]
      target = {
        pageId: page.pageId,
        title: page.title,
        projectId: page.projectId,
        projectName: page.projectName,
        projectSlug: page.projectSlug,
        crumb: crumbOf(page),
        matchCount: 0,
        page: 0,
        entries: 0,
        transcript: 0,
        snippet: first === undefined ? null : { prefix: squash(first.prefix), match: first.match, suffix: squash(first.suffix) },
        matches: [],
        transcriptMatches: [],
      }
      merged.set(page.pageId, target)
    }
    target.transcript += hit.matchCount
    target.matchCount += hit.matchCount
    target.transcriptMatches = [...target.transcriptMatches, ...hit.matches]
  }
  return [...merged.values()].sort((left, right) => right.matchCount - left.matchCount)
}
