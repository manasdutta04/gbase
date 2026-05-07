export interface GBaseRef {
  __gbase_ref: true;
  collection: string;
  id: string;
}

/**
 * Creates a reference to a document in another collection.
 * References are stored as metadata and can be lazily loaded via .populate()
 */
export function ref(collection: string, id: string): GBaseRef {
  return {
    __gbase_ref: true,
    collection,
    id,
  };
}

/**
 * Type guard to check if a value is a GBase reference
 */
export function isRef(val: any): val is GBaseRef {
  return val && typeof val === 'object' && val.__gbase_ref === true;
}
