/**
 * The simulated advertisers: real product URLs, taken (URLs only) from the outbid.lol leaderboard
 * the owner supplied. List order is kept — the top of that board spends the most, so the first
 * advertisers here get the biggest budgets.
 *
 * The app reads each site's own logo and description, exactly as it would for a real buyer, so
 * running the simulator makes a handful of ordinary page requests to these sites.
 */
export const ADVERTISER_URLS: readonly string[] = [
  'https://see.io',
  'https://tutti.so',
  'https://joni.ai',
  'https://outrank.so',
  'https://orynth.dev',
  'https://crowdreply.io',
  'https://trycomp.ai',
  'https://zerorank.ai',
  'https://flopay.com',
  'https://pecan.ai',
  'https://capgo.app',
  'https://venturelabs.io',
  'https://lawofattractioncourse.com',
  'https://olvy.co',
  'https://turingo.net',
  'https://peptidebenchmark.com',
  'https://auraplusplus.com',
  'https://premierdelaclasse.lol',
  'https://outbid.immo',
  'https://indie.game',
  'https://substack.com',
  'https://paywithfour.com',
  'https://joinyoho.com',
  'https://researchpeptidehub.com',
  'https://editorskeys.com',
  'https://attentionfactory.com',
  'https://post-bridge.com',
  'https://vapospy.com',
  'https://colonist.io',
  'https://torrentclaw.com',
  'https://casinosblockchain.io',
  'https://visuallift.ai',
  'https://automailer.io',
  'https://pokerink.com',
  'https://mailivery.io',
  'https://coinfuty.com',
  'https://oneword.global',
  'https://educate10millionpeople.com',
  'https://adyntel.com',
  'https://scrape.do',
  'https://tracked-app.com',
  'https://owskimedia.com',
  'https://producthunt.com/products/articos',
  'https://txtcart.ai',
  'https://overround.pro',
  'https://nicheranker.com',
  'https://spinhire.us',
  'https://mokshahaus.com',
  'https://superstables.com',
  'https://invofox.com',
  'https://dupe.com',
  'https://x.com/robbyfrank',
  'https://theinfluencer.ai',
  'https://tinystartups.com',
  'https://petecodes.io',
  'https://raekdata.com',
  'https://divi.fund',
  'https://tolt.com',
  'https://knoku.com',
  'https://linkedin.com/in/arnauddumasderauly',
]

/**
 * A distinct brand colour per advertiser. A real buyer's browser samples this from their logo;
 * the simulator has no browser, so it picks one deterministically from the domain instead.
 */
const PALETTE = [
  '#E4572E', '#3A86FF', '#F3A712', '#2A9D8F', '#E76F51', '#8338EC', '#FB5607', '#FF006E', '#06D6A0',
  '#118AB2', '#EF476F', '#FFD166', '#9B5DE5', '#00BBF9', '#F15BB5', '#00F5D4', '#FEE440', '#43AA8B',
  '#F94144', '#577590',
] as const

export function colorFor(domain: string): string {
  let hash = 0
  for (const char of domain) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length] as string
}

/**
 * URLs that point at a page on someone else's platform. The app's identity is the hostname, so
 * `x.com/robbyfrank` becomes the empire `x.com` and shows X's logo — worth knowing, not a crash.
 */
export function platformPageNotes(urls: readonly string[]): string[] {
  return urls
    .filter((url) => {
      const pathname = new URL(url).pathname
      return pathname !== '/' && pathname !== ''
    })
    .map((url) => {
      const host = new URL(url).hostname
      return `${url} becomes the empire "${host}" and will show ${host}'s logo, not this page's`
    })
}
