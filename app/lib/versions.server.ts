import { env } from 'cloudflare:workers'
import type { Block } from '../../workers/doc'

export type { Block, Version } from '../../workers/doc'

// The object that holds this document's text. Its methods run inside the object (RPC).
export const docStub = (documentId: string) => env.DOC.get(env.DOC.idFromName(documentId))

export type DiffRow = { kind: 'same' | 'removed' | 'added'; block: Block }

const same = (a: Block, b: Block) => a.type === b.type && a.level === b.level && a.text === b.text

// Block-level diff: longest common subsequence, then everything off the path is removed or added.
// ponytail: O(n·m) table, fine for documents; capped at 2000 blocks a side. Word-level diff later if wanted.
export const diffBlocks = (from: Block[], to: Block[]): DiffRow[] => {
  const a = from.slice(0, 2000), b = to.slice(0, 2000)
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = same(a[i], b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const rows: DiffRow[] = []
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(a[i], b[j])) rows.push({ kind: 'same', block: a[i++] }), j++
    else if (j < b.length && (i >= a.length || lcs[i][j + 1] > lcs[i + 1][j])) rows.push({ kind: 'added', block: b[j++] })
    else rows.push({ kind: 'removed', block: a[i++] })
  }
  return rows
}
