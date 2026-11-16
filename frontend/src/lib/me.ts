import { createContext, useContext } from 'react'
import type { CrmUser } from './crm'

/** Who is signed in to the dispatch board, for every page (null when signed out). */
export const MeContext = createContext<CrmUser | null>(null)
export const useMe = () => useContext(MeContext)

export const firstName = (u: CrmUser) => (u.name || u.email).trim().split(/\s+/)[0]
