import {
  Collection,
  Product,
  SanityClient,
  SyncOperation,
  SanityShopifyDocument,
} from '@sane-shopify/types'
import { isMatch } from 'lodash'
import { prepareDocument, sleep } from './utils'
import { SanityCache } from './sanityUtils'

const mergeExistingFields = (
  docInfo: any,
  existingDoc: SanityShopifyDocument
) => {
  const variants = docInfo.variants || []
  const options = docInfo.options || []
  return {
    ...docInfo,
    options: options.map((updatedOption) => {
      const existingOption = existingDoc.options
        ? existingDoc.options.find((o) => o._key === updatedOption._key) || {}
        : {}

      const existingOptionValues = existingOption.values || []

      return {
        ...existingOption,
        ...updatedOption,
        values: updatedOption.values.map((updatedOptionValue) => {
          const existingOptionValue = existingOptionValues.find(
            (v) => v._key === updatedOptionValue._key
          )
          return {
            ...existingOptionValue,
            ...updatedOptionValue,
          }
        }),
      }
    }),

    variants: variants.map((variant) => {
      const existingVariant = existingDoc.variants
        ? existingDoc.variants.find((v) => v.id === variant.id) || {}
        : {}

      return {
        ...existingVariant,
        ...variant,
      }
    }),
  }
}

export const createSyncSanityDocument = (
  client: SanityClient,
  cache: SanityCache
) => async (item: Product | Collection): Promise<SyncOperation> => {
  const getSanityDocByShopifyId = async (
    shopifyId: string
  ): Promise<SanityShopifyDocument | void> => {
    const cached = cache.getByShopifyId(shopifyId)
    if (cached) return cached

    const doc = await client.fetch<SanityShopifyDocument>(
      `*[shopifyId == $shopifyId]{
        products[]->,
        collections[]->,
        "collectionKeys": collections[]{
          ...
        },
        "productKeys": products[] {
          ...
        },
        ...
      }[0]`,
      {
        shopifyId,
      }
    )
    if (doc) cache.set(doc)
    return doc
  }

  const syncItem = async (
    item: Product | Collection
  ): Promise<SyncOperation> => {
    const docInfo = prepareDocument(item)
    const existingDoc = await getSanityDocByShopifyId(item.id)

    /* If the document exists and is up to date, skip */
    if (existingDoc && isMatch(existingDoc, docInfo)) {
      return {
        type: 'skip' as 'skip',
        sanityDocument: existingDoc,
        shopifySource: item,
      }
    }

    /* Rate limit */
    await sleep(201)

    /* Create a new document if none exists */
    if (!existingDoc) {
      const newDoc = await client.create<SanityShopifyDocument>(docInfo)
      const refetchedDoc = await getSanityDocByShopifyId(newDoc.shopifyId)
      if (!refetchedDoc) {
        throw new Error(
          `Could not fetch updated document with shopifyId ${newDoc.shopifyId}`
        )
      }

      cache.set(refetchedDoc)
      return {
        type: 'create' as 'create',
        sanityDocument: newDoc,
        shopifySource: item,
      }
    }

    /* Otherwise, update the existing doc */

    const updatedDoc = await client
      .patch<SanityShopifyDocument>(existingDoc._id)
      .set(mergeExistingFields(docInfo, existingDoc))
      .commit()

    const refetchedDoc = await getSanityDocByShopifyId(updatedDoc.shopifyId)
    if (!refetchedDoc) {
      throw new Error(
        `Could not fetch updated document with shopifyId ${updatedDoc.shopifyId}`
      )
    }
    cache.set(refetchedDoc)

    return {
      type: 'update' as 'update',
      sanityDocument: refetchedDoc,
      shopifySource: item,
    }
  }

  return syncItem(item)
}
