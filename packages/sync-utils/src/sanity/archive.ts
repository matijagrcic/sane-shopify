import { SanityClient, SanityShopifyDocument } from '@sane-shopify/types'

export const createArchiveSanityDocument = (client: SanityClient) => async (
  doc: SanityShopifyDocument
): Promise<SanityShopifyDocument> => {
  const relationshipsKey =
    doc.sourceData.__typename === 'Collection' ? 'products' : 'collections'
  const removeRelationships = async (relatedDoc: SanityShopifyDocument) => {
    const type =
      relatedDoc.sourceData.__typename === 'Collection'
        ? 'products'
        : 'collections'

    const related = relatedDoc[type].find(
      (reference) => reference._ref === doc._id
    )
    if (!related) return

    const relationshipsToRemove = [`${type}[_key=="${related._key}"]`]

    const result = await client
      .patch(relatedDoc._id)
      // @ts-ignore
      .unset(relationshipsToRemove)
      .commit()
  }
  const relationships = doc[relationshipsKey]
  if (!relationships) return doc
  await Promise.all(relationships.map((r) => removeRelationships(r)))
  await client
    .patch(doc._id)
    .set({ archived: true, [relationshipsKey]: [] })
    .commit()
  return doc
}
