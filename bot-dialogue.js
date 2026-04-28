function pick(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  return items[Math.floor(Math.random() * items.length)] || items[0];
}

const MILKMAN_REPLIES = [
  'The Milkman knocked once and the wallpaper started listening.',
  'The Milkman says the quiet cartons are the dangerous ones.',
  'Nobody in Harmony Town makes eye contact with the Milkman before noon.',
  'The Milkman left a note that just said "still warm."',
  'The Milkman knows which plush toys have porch keys.',
  'The Milkman whistles in aisles that do not exist yet.',
  'A carton arrived with no label and everyone got polite about it.',
  'The Milkman does not jog. The street simply moves around him.',
  'The Milkman says heartbreak should be stored upright.',
  'Someone asked the Milkman for directions and now their mailbox hums.',
  'The Milkman once blinked at the town clock and it lost seven minutes.',
  'The Milkman keeps exact change for feelings nobody ordered.',
  'In Harmony Town, the Milkman is considered weather.',
  'The Milkman has never been late, only early in unsettling ways.',
  'The Milkman says every plush toy squeaks differently under pressure.',
  'The Milkman waved at a window and the curtains resigned.',
  'Nobody remembers hiring the Milkman, which is his strongest quality.',
  'The Milkman left a bottle on the stoop and the stoop thanked him.',
  'The Milkman says the moon is just a cap you twist off slowly.',
  'The Milkman smells faintly of vanilla and terrible foresight.',
  'The Milkman already knows who is pretending to be over it.',
  'A cold bottle means delivery. A warm bottle means warning.',
  'The Milkman counts in clinks, not numbers.',
  'The Milkman says every cul-de-sac is a bowl if you look at it kindly.',
  'Harmony Town only gets nervous when the Milkman is cheerful.',
  'The Milkman handed me a receipt with tomorrow on it.',
  'The Milkman says a plush heart can bruise without tearing.',
  'The Milkman never parks. He arrives.',
  'The Milkman knows which sidewalks gossip after dark.',
  'The Milkman is why the fridge light flinches.',
  'The Milkman says spilled love attracts ants and poetry in equal measure.',
  'The Milkman once delivered to an address that apologized first.',
  'If the Milkman laughs, check your windows.',
  'The Milkman says carton corners remember everything.',
  'The Milkman does not believe in closure, only cooling time.',
  'Harmony Town measures trust in bottles and squeaks.',
  'The Milkman tapped the fence twice and the roses went quiet.',
  'The Milkman has a route through dreams and a shorter one through kitchens.',
  'The Milkman says every porch has one truthful floorboard.',
  'Nobody interrupts the Milkman when he is looking at puddles.',
  'The Milkman left foam on the step in the shape of a warning.',
  'The Milkman says some hearts need refrigeration, not advice.',
  'The Milkman made a left turn and three rumors hatched.',
  'The Milkman knows the names of all the broken zippers.',
  'The Milkman says Harmony Town was stitched from the inside out.',
  'A plush toy can lie. A milk bottle usually will not.',
  'The Milkman once smiled at the deli counter and the cheese sweated.',
  'The Milkman says grief travels best in crates.',
  'If you hear glass clink twice, he has already passed.',
  'The Milkman keeps his secrets under silver caps.',
  'The Milkman says the loneliest houses always have the cleanest steps.',
  'The Milkman delivered a bottle to the park bench and nobody questioned it.',
  'The Milkman is the only man in town allowed to carry dawn by hand.',
  'The Milkman says plush fur hides evidence beautifully.',
  'The Milkman once asked for a straw and the mayor moved away.',
  'The Milkman trusts nobody who opens the door too fast.',
  'The Milkman says some neighborhoods curdle at sunset.',
  'There are easier ways to meet the Milkman than saying his name, but not better ones.',
  'The Milkman can hear a lie through two walls and a tea towel.',
  'The Milkman says heartbreak tastes different in glass.',
];

const UNBURN_QUOTES = [
  { text: 'Parting is such sweet sorrow.', source: 'Shakespeare' },
  {
    text: "'Tis better to have loved and lost than never to have loved at all.",
    source: 'Tennyson',
  },
  { text: 'The heart was made to be broken.', source: 'Oscar Wilde' },
  { text: 'Love is so short, forgetting is so long.', source: 'Pablo Neruda' },
  { text: 'Where there is love there is pain.', source: 'Spanish Proverb' },
  { text: 'Hearts crack. Plush hearts squeak first.', source: 'Harmony Town' },
  { text: 'Some goodbyes leave soot on the seams.', source: 'Harmony Town' },
  { text: 'Even stitched-up hearts remember the flame.', source: 'Harmony Town' },
  { text: 'Love left the porch light on. Loss still found the door.', source: 'Harmony Town' },
  { text: 'A burnt edge is still an edge worth holding.', source: 'Harmony Town' },
  { text: 'The Milkman says the bottle chills first, then the truth.', source: 'Milkman Lore' },
  {
    text: 'Some love stories curdle before sunrise, but the Milkman still makes the route.',
    source: 'Milkman Lore',
  },
  { text: 'Burnt edges, steady hands, one more dawn.', source: 'Milkman Lore' },
  {
    text: 'Even a spilled heart leaves a trail home if the Milkman is watching.',
    source: 'Milkman Lore',
  },
  { text: 'Heartbreak looks louder when the room goes quiet.', source: 'Late Delivery' },
  { text: 'The seams held. The story did not.', source: 'Harmony Town' },
  { text: 'Love can leave without taking its fingerprints.', source: 'Harmony Town' },
  { text: 'A plush toy can survive the fire and still miss the room.', source: 'Harmony Town' },
  { text: 'No one warns you how heavy a soft goodbye feels.', source: 'Harmony Town' },
  { text: 'The ash is only proof that something warm was here.', source: 'Harmony Town' },
  { text: 'Some losses arrive dressed like lessons.', source: 'Harmony Town' },
  { text: 'The Milkman says grief should never be microwaved.', source: 'Milkman Lore' },
  { text: 'Harmony Town teaches recovery one strange morning at a time.', source: 'Harmony Town' },
  { text: 'Love left a dent. The plush stayed standing.', source: 'Harmony Town' },
];

const COMMUNITY_BLURBS = [
  'Linked holders, supply share, and a little Harmony Town gossip in one clean read.',
  'A tidy read on who is holding plush, who is moving, and how loud the floorboards are.',
  'Community grip, market pulse, and just enough squeak to keep it lively.',
  'A live look at who is hugging supply and who is just watching the sidewalk.',
  'The town bulletin board, but cleaner and with fewer thumbtacks.',
  'Numbers from the neighborhood, stitched up neatly for one glance.',
];

const COMMUNITY_FOOTERS = [
  'LIVE SNAPSHOT',
  'TOWN SNAPSHOT',
  'COMMUNITY SNAPSHOT',
];

const RANKINGS_SUBTITLES = [
  'The current pecking order from the plush side of town.',
  'Harmony Town keeps a ladder. Somebody has to squeak the loudest.',
  'A live look at which plush resident is currently hogging the spotlight.',
  'The ranking board is up and the stuffing is competitive today.',
  'Live standings from the softest rivalry in town.',
];

const RANKINGS_LEFT_LABELS = ['Top Slice', 'Top Stack', 'Front Row'];
const RANKINGS_RIGHT_LABELS = ['Leader', 'Front Plush', 'Current Problem'];
const RANKINGS_FOOTERS = ['LIVE LADDER', 'TOWN LADDER', 'PLUSH PECKING ORDER'];

const HARMIE_SUBTITLES = [
  'Front and center, like it knows exactly where the camera is.',
  'One plush citizen, professionally framed and mildly suspicious.',
  'A clean spotlight for a Harmie with good posture and strange energy.',
  'The main character for at least the next few seconds.',
  'A proper look at one resident of Harmony Town.',
];

const HARMIE_RECORD_LABELS = ['Record', 'Scoreboard', 'Battle Log'];
const HARMIE_TRAIT_LABELS = ['Trait', 'Detail', 'Stitch Notes'];
const HARMIE_FOOTERS = ['NFT SPOTLIGHT', 'SOFT FOCUS', 'COLLECTION SPOTLIGHT'];

const WALLET_SUBTITLES = [
  'Your connected wallets and total position, packed tighter than a toy chest.',
  'A private holdings check with less clutter and better posture.',
  'Everything linked up neatly, like Harmony Town finally found a filing cabinet.',
  'A cleaner look at your plush exposure and the pockets it lives in.',
  'Your linked stack, kept crisp and out of the public milk fog.',
];

const WALLET_LEFT_LABELS = ['Linked Wallets', 'Connected Pockets', 'Wallet Row'];
const WALLET_RIGHT_LABELS = ['Primary', 'Main Route', 'Head Pocket'];
const WALLET_FOOTERS = ['PRIVATE SNAPSHOT', 'PRIVATE STASH', 'SOFT LEDGER'];

const VERIFY_LINK_SUBTITLES = [
  'Open the verifier, sign once, and prove your Harmies without any weird on-chain business.',
  'One clean signature, one cleaner wallet check, zero rug-pull theater.',
  'A tidy proof pass for your plush stash. No transactions, no nonsense.',
  'Step into the verifier, wave the wallet, leave with your dignity intact.',
];

const VERIFY_REVERIFY_SUBTITLES = [
  'Refresh your wallet proof without nudging the blockchain into a panic.',
  'A quick recheck so the bot knows your pockets still squeak.',
  'Fresh proof, same wallet, no dramatic hand gestures required.',
  'Run the check again and let the verifier dust off the clipboard.',
];

const VERIFY_CHECKS = [
  'Current Harmies ownership only.\nNo token approvals.\nNo transaction prompts.',
  'We only check whether the wallet is holding Harmies right now.\nNo approvals.\nNo spending prompts.',
  'Ownership proof only.\nNo transfers.\nNo sneaky extras hiding in the seams.',
];

const VERIFY_SAFETY = [
  'One signed message.\nServer-side verification.\nMulti-wallet friendly.',
  'Sign once.\nWe verify the hold.\nYour wallet stays out of the blender.',
  'A single signature.\nNo spending permissions.\nNo tricks in the milk crate.',
];

const VERIFY_FOOTERS = ['SECURE ACCESS', 'VERIFICATION ROUTE', 'SAFE PASS'];

const FLEX_KICKERS = ['WALLET FLEX', 'SOFT FLEX', 'HARMIE PARADE'];
const FLEX_SUMMARIES = [
  'Everything in your wallet, lined up like a very polite plush procession.',
  'A clean wall of Harmies, arranged with just enough bragging.',
  'Harmony Town calls this subtle. Everybody else calls it flexing.',
  'A tidy spread of plush wealth with the corners tucked in.',
  'Your Harmies, grouped like they showed up early for picture day.',
];
const FLEX_PARTIAL_SUMMARIES = [
  'Showing {shown} of {total} Harmies so the grid can breathe.',
  'A sample of {shown} from your stack of {total}. The rest are backstage.',
  'Pulled {shown} from {total} holdings for one clean flex page.',
  'Only {shown} made the page. The rest of the {total} are still in makeup.',
];

const AUDIT_SUBTITLES = [
  'A quick health pass over linked wallets and the ones squeaking a little too loudly.',
  'The guild clipboard: who is linked, who is stale, who probably needs a second look.',
  'A clean audit snapshot for the wallets still behaving and the ones acting haunted.',
  'Linked wallet health, minus the panic and plus a little Harmony Town suspicion.',
];

const AUDIT_FOOTERS = ['AUDIT SNAPSHOT', 'HEALTH CHECK', 'WALLET WATCH'];

const TRADE_LINES = [
  'Harmony Town definitely noticed that one.',
  'The stuffing market remains dramatic.',
  'Somewhere, a porch light flickered approvingly.',
  'A clean move with just a trace of weirdness.',
  'The neighborhood ledger just got a little louder.',
];

const PAGEANT_LINES = [
  'Soft faces, hard choices.',
  'Harmony Town remains deeply competitive for a place made of plush.',
  'The judges are imaginary, but the votes are very real.',
  'A polite little beauty contest with extremely serious stuffing.',
];

const MEME_CAPTIONS = [
  'Harmony Town filed this under important civic material.',
  'The town archivist called this evidence, not art.',
  'A completely normal Harmie meme for a completely normal day.',
  'The plush press has released another troubling image.',
  'This one was found pinned to the community corkboard.',
  'The stuffing remains unserious even when the framing is not.',
  'A fresh dispatch from the stranger side of Harmony Town.',
  'Nobody claims to have made this, which feels correct.',
  'One more visual update from the softest chaos pocket on the map.',
  'The meme route is running on time today.',
];

export function getRandomUnburnQuote() {
  return pick(UNBURN_QUOTES) || UNBURN_QUOTES[0];
}

export function mentionsMilkman(text) {
  return /\bmilk\s*man(?:'s)?\b/i.test(String(text || ''));
}

export function getMilkmanReply() {
  return pick(MILKMAN_REPLIES);
}

export function getCommunityDialogue() {
  return {
    blurb: pick(COMMUNITY_BLURBS),
    footerLabel: pick(COMMUNITY_FOOTERS),
  };
}

export function getRankingsDialogue({ leader } = {}) {
  return {
    subtitle: leader
      ? `${leader.name} is out front. ${pick(RANKINGS_SUBTITLES)}`
      : 'No ranking data is available yet.',
    leftLabel: pick(RANKINGS_LEFT_LABELS),
    rightLabel: pick(RANKINGS_RIGHT_LABELS),
    footerLabel: pick(RANKINGS_FOOTERS),
  };
}

export function getHarmieDialogue({ harmie } = {}) {
  return {
    subtitle: harmie?.description
      ? harmie.description
      : pick(HARMIE_SUBTITLES),
    leftLabel: pick(HARMIE_RECORD_LABELS),
    rightLabel: pick(HARMIE_TRAIT_LABELS),
    footerLabel: pick(HARMIE_FOOTERS),
  };
}

export function getWalletDialogue() {
  return {
    subtitle: pick(WALLET_SUBTITLES),
    leftLabel: pick(WALLET_LEFT_LABELS),
    rightLabel: pick(WALLET_RIGHT_LABELS),
    footerLabel: pick(WALLET_FOOTERS),
  };
}

export function getWalletLinkDialogue(operation = 'link') {
  return {
    subtitle:
      operation === 'reverify'
        ? pick(VERIFY_REVERIFY_SUBTITLES)
        : pick(VERIFY_LINK_SUBTITLES),
    checks: pick(VERIFY_CHECKS),
    safety: pick(VERIFY_SAFETY),
    footerLabel: pick(VERIFY_FOOTERS),
  };
}

export function getFlexDialogue({ shown = 0, total = 0 } = {}) {
  const partial = pick(FLEX_PARTIAL_SUMMARIES)
    .replace('{shown}', String(shown))
    .replace('{total}', String(total));

  return {
    kicker: pick(FLEX_KICKERS),
    summary: shown >= total ? pick(FLEX_SUMMARIES) : partial,
  };
}

export function getWalletAuditDialogue({ staleWallets = 0 } = {}) {
  return {
    subtitle: pick(AUDIT_SUBTITLES),
    footerLabel: pick(AUDIT_FOOTERS),
    coverageLine:
      staleWallets > 0
        ? 'A follow-up pass is recommended before the milk crates get ideas.'
        : 'Everything looks healthy enough to leave unattended for a minute.',
  };
}

export function getWalletTradeLine() {
  return pick(TRADE_LINES);
}

export function getCollectionTradeLine() {
  return pick(TRADE_LINES);
}

export function getPageantLine() {
  return pick(PAGEANT_LINES);
}

export function getMemeCaption() {
  return pick(MEME_CAPTIONS);
}

export function getHarmieNotFoundLine(query) {
  const target = query ? `\`${query}\`` : 'that request';
  return pick([
    `I couldn't find a Harmie matching ${target}. Harmony Town checked under the couch cushions too.`,
    `No Harmie answered to ${target}. Either the name is off or it slipped behind the toy chest.`,
    `Nothing matched ${target} in the archive or live site data. The plush census came up empty.`,
  ]);
}

export function getNoHarmiesLine() {
  return pick([
    'No Harmies are available yet from the local archive or the live site.',
    'The shelf is empty right now. No Harmies came back from the archive or the site.',
    'No Harmies surfaced yet. Harmony Town is unusually quiet.',
  ]);
}

export function getNoBurntLine() {
  return pick([
    'No burnt Harmies are available yet. Add images to `assets/burnt` first.',
    'The burnt drawer is empty right now. Drop images into `assets/burnt` first.',
    'No burnt Harmies are loaded yet. The ash pile needs files in `assets/burnt`.',
  ]);
}

export function getNoMemesLine() {
  return pick([
    'No Harmie memes are loaded yet. Add files to `assets/harmie-memes` first.',
    'The meme drawer is empty right now. Drop images into `assets/harmie-memes` first.',
    'No memes surfaced from `assets/harmie-memes`. Harmony Town is being unusually responsible.',
  ]);
}

export function getNoWalletLinkedLine() {
  return pick([
    'No wallet is linked yet. Run `/link-wallet` first.',
    'Your pockets are still unintroduced. Run `/link-wallet` first.',
    'No wallet is linked yet. The verifier clipboard is still blank.',
  ]);
}

export function getWalletNotLinkedLine() {
  return pick([
    'That wallet is not linked to your Discord account.',
    'That wallet is not on your linked list.',
    'No match for that wallet on your account. The ledger shook its head.',
  ]);
}

export function getWalletRemovedLine(walletAddress) {
  return pick([
    `Removed linked wallet \`${walletAddress}\`.`,
    `Linked wallet \`${walletAddress}\` has been removed from your route.`,
    `Unlinked \`${walletAddress}\`. One less pocket on the clipboard.`,
  ]);
}

export function getFlexNoWalletLine() {
  return pick([
    'Link your wallet first with `/link-wallet`, then use `/flex` again.',
    'No linked wallet yet. Do `/link-wallet` first, then come back and flex properly.',
    'Your flex needs a wallet first. Start with `/link-wallet`.',
  ]);
}

export function getFlexNoHoldingsLine() {
  return pick([
    'Your linked wallet is connected, but I do not have any Harmie holdings saved yet.',
    'Wallet linked, stash not loaded. I do not have any Harmie holdings saved yet.',
    'The wallet is there, but the plush shelf looks empty in cache right now.',
  ]);
}

export function getCommunityGuildOnlyLine() {
  return pick([
    'Community stats only make sense inside a Discord server.',
    'That one needs a server around it. Community stats are guild-only.',
    'Community stats are for servers. DMs do not have enough neighborhood energy.',
  ]);
}

export function getAuditGuildOnlyLine() {
  return pick([
    'Wallet audit only makes sense inside a Discord server.',
    'That audit needs a guild. DMs do not provide enough paperwork.',
    'Wallet audit is guild-only. The clipboard refuses to work alone.',
  ]);
}

export function getPageantSessionMissingLine() {
  return pick([
    'I could not load that pageant session anymore.',
    'That pageant round has wandered off.',
    'I cannot find that matchup now. The ribbon table is empty.',
  ]);
}

export function getPageantClosedLine() {
  return pick([
    'That matchup is closed.',
    'Voting is closed on that round.',
    'That pageant round already packed up its folding chairs.',
  ]);
}

export function getPageantAlreadyVotedLine() {
  return pick([
    'You already voted on this matchup.',
    'One vote each. You already used yours on this round.',
    'You already cast a vote here. The sash committee remembers.',
  ]);
}

export function getPageantSkippedLine() {
  return pick([
    'Skipped. Fresh matchup posted.',
    'Round skipped. A new plush showdown is up.',
    'Skipped cleanly. Harmony Town sent out another contender pair.',
  ]);
}

export function getPageantSkipErrorLine(errorMessage) {
  return pick([
    `I skipped that round, but couldn't render the next matchup: ${errorMessage}`,
    `Round skipped, but the next matchup failed to render: ${errorMessage}`,
    `The skip worked. The next card did not. Reason: ${errorMessage}`,
  ]);
}

export function getVoteRecordedLine() {
  return pick([
    'Vote recorded for this matchup.',
    'Vote locked in. The plush tribunal has heard you.',
    'Vote recorded. Harmony Town will absolutely overreact.',
  ]);
}

export function getVoteFallbackLine() {
  return pick([
    'Vote recorded in Discord. Site voting is blocked right now, so this matchup is using the Discord live tracker.',
    'Vote saved locally in Discord because the site vote path is blocked right now.',
    'The site route is blocked, so I recorded that vote in the Discord live tracker instead.',
  ]);
}
