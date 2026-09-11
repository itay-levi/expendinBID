/** A tile's state at the moment it was priced — what the payment was for. */
export type PreviousState = { ownerId: string | null; lastPricePaidCents: number }

export type AppliedPurchase = {
  ref: string
  via: 'checkout' | 'webhook'
  buyer: string
  hexIds: string[]
  /**
   * State each tile was bought FROM. Null when another buyer acted in between and the simulator
   * cannot know the exact state the server priced — such purchases are left out of exact checks.
   */
  previous: PreviousState[] | null
  /** What each tile should now be recorded at: an even split of the territory total. */
  shares: number[]
  territoryCents: number
  /** Everything the customer paid, including protection and tax. */
  paidCents: number
  atMs: number
}

/**
 * The simulator's own book of every purchase the server accepted. At the end it is compared with
 * what the app reports — ownership, recorded prices and revenue must all add up.
 */
export class SimLedger {
  readonly applied: AppliedPurchase[] = []
  /** Domains blocked for a chargeback, with the time they were blocked. */
  readonly blocked = new Map<string, number>()

  record(purchase: AppliedPurchase): void {
    this.applied.push(purchase)
  }

  revenueCents(): number {
    return this.applied.reduce((sum, purchase) => sum + purchase.territoryCents, 0)
  }

  paidCents(): number {
    return this.applied.reduce((sum, purchase) => sum + purchase.paidCents, 0)
  }

  paidBy(buyer: string): number {
    return this.applied.filter((purchase) => purchase.buyer === buyer).reduce((sum, purchase) => sum + purchase.paidCents, 0)
  }

  /** Tiles bought from somebody else rather than from open ground. */
  takeovers(): number {
    return this.applied.reduce(
      (sum, purchase) => sum + (purchase.previous ?? []).filter((state) => state.ownerId !== null).length,
      0,
    )
  }
}
