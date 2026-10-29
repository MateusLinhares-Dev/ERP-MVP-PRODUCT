/** Persist a help document with optimistic revisions.
 * RTDB transactions may initially run against an empty local cache. Reading the
 * exact child first is essential: aborting on that provisional null produced
 * spurious 404s for articles that were actually present in the database.
 */
export async function mutateHelpArticle(ref, { action, id, revision, article, actor }) {
  const original = await ref.get();
  if (action === 'delete' && !original.exists()) return { outcome: 'not_found' };
  if (action === 'save' && !original.exists() && id) return { outcome: 'not_found' };
  let conflict = false;
  const result = await ref.transaction(current => {
    if (action === 'delete') {
      if (!current) return; // May have been deleted after the pre-read.
      if (current.revision !== revision) { conflict = true; return; }
      return null;
    }
    if (!current && id) return;
    if (current && current.revision !== revision) { conflict = true; return; }
    const now = Date.now();
    return { ...article, id: ref.key, revision: (current?.revision || 0) + 1,
      createdAt: current?.createdAt || now, createdBy: current?.createdBy || actor,
      updatedAt: now, updatedBy: actor };
  }, undefined, false);
  if (!result.committed) return { outcome: conflict ? 'conflict' : 'not_found' };
  return { outcome: 'ok', article: result.snapshot.val() };
}
